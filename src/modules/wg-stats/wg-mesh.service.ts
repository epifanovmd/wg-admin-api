import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { WgNodeRepository } from "../wg-node";
import { WgMeshUpdatedEvent } from "./events";
import { WgLiveStore } from "./wg-live-store.service";
import type {
  IWgMeshCell,
  IWgMeshMatrix,
  IWgNodeProbe,
  IWgProbeTarget,
} from "./wg-stats.types";

/** Агент пробует ноды раз в минуту — держим с запасом на пропуски. */
const MESH_TTL_SEC = 180;
/**
 * Окно, за которое усредняются потери, мс.
 *
 * Проба — несколько пакетов раз в минуту, и одна потеря в ней — десятки
 * процентов. По одной пробе пара мигала бы «потерями» на каждом случайном
 * пакете; среднее за пять проб показывает то, что держится.
 */
const MESH_WINDOW_MS = 5 * 60_000;
/** Для матрицы из десятков нод; больше — уже не матрица для глаз. */
const MAX_PROBE_TARGETS = 50;

type TMeshProbes = Record<
  string,
  { rttMs: number | null; lossPercent: number }
>;

interface IMeshSample {
  ts: string;
  probes: TMeshProbes;
}

/** Пробы ноды за окно; прежний формат — одна проба без истории. */
type TStoredMesh = { samples: IMeshSample[] } | IMeshSample;

const toSamples = (stored: TStoredMesh | null): IMeshSample[] =>
  !stored ? [] : "samples" in stored ? stored.samples : [stored];

const round1 = (value: number): number => Math.round(value * 10) / 10;

const meshKey = (fromNodeId: string): string => `mesh:${fromNodeId}`;

/**
 * Связность нод между собой: каждый агент пингует publicHost остальных нод,
 * последние измерения «откуда → куда» — в live-хранилище.
 */
@Injectable()
export class WgMeshService {
  constructor(
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Кого пинговать ноде: остальные ноды с публичным адресом. */
  async probeTargetsFor(nodeId: string): Promise<IWgProbeTarget[]> {
    const nodes = await this._allNodes();

    return nodes
      .filter(node => node.id !== nodeId && node.publicHost)
      .slice(0, MAX_PROBE_TARGETS)
      .map(node => ({ nodeId: node.id, host: node.publicHost! }));
  }

  async recordProbes(
    fromNodeId: string,
    probes: IWgNodeProbe[],
  ): Promise<void> {
    const now = Date.now();
    const sample: IMeshSample = { ts: new Date(now).toISOString(), probes: {} };

    for (const probe of probes) {
      if (probe.nodeId === fromNodeId) continue;
      sample.probes[probe.nodeId] = {
        rttMs: probe.rttMs,
        lossPercent: probe.lossPercent,
      };
    }

    const previous = toSamples(
      await this._live.getJson<TStoredMesh>(meshKey(fromNodeId)),
    ).filter(item => now - Date.parse(item.ts) < MESH_WINDOW_MS);

    await this._live.setJson(
      meshKey(fromNodeId),
      { samples: [...previous, sample] },
      MESH_TTL_SEC,
    );
    this._eventBus.emit(new WgMeshUpdatedEvent(await this.matrix()));
  }

  async matrix(): Promise<IWgMeshMatrix> {
    const nodes = await this._allNodes();
    const known = new Set(nodes.map(node => node.id));
    const cells: IWgMeshCell[] = [];

    for (const from of nodes) {
      const samples = toSamples(
        await this._live.getJson<TStoredMesh>(meshKey(from.id)),
      );
      const latest = samples[samples.length - 1];

      if (!latest) continue;

      for (const [toNodeId, probe] of Object.entries(latest.probes)) {
        if (!known.has(toNodeId)) continue;

        // Окно отсчитывается от последней пробы, а не от «сейчас»: так
        // среднее не меняется между пробами само по себе.
        const losses = samples
          .filter(
            item =>
              Date.parse(latest.ts) - Date.parse(item.ts) < MESH_WINDOW_MS,
          )
          .flatMap(item => {
            const cell = item.probes[toNodeId];

            return cell ? [cell.lossPercent] : [];
          });

        cells.push({
          fromNodeId: from.id,
          toNodeId,
          rttMs: probe.rttMs,
          lossPercent: round1(
            losses.reduce((sum, value) => sum + value, 0) / losses.length,
          ),
          samples: losses.length,
          ts: latest.ts,
        });
      }
    }

    return {
      nodes: nodes.map(node => ({ id: node.id, name: node.name })),
      cells,
    };
  }

  private _allNodes() {
    return this._nodes.find({
      select: { id: true, name: true, publicHost: true },
      order: { createdAt: "ASC" },
    });
  }
}
