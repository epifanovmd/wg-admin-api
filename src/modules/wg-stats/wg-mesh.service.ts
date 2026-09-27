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
/** Для матрицы из десятков нод; больше — уже не матрица для глаз. */
const MAX_PROBE_TARGETS = 50;

interface IStoredMesh {
  ts: string;
  probes: Record<string, { rttMs: number | null; lossPercent: number }>;
}

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
    const stored: IStoredMesh = { ts: new Date().toISOString(), probes: {} };

    for (const probe of probes) {
      if (probe.nodeId === fromNodeId) continue;
      stored.probes[probe.nodeId] = {
        rttMs: probe.rttMs,
        lossPercent: probe.lossPercent,
      };
    }

    await this._live.setJson(meshKey(fromNodeId), stored, MESH_TTL_SEC);
    this._eventBus.emit(new WgMeshUpdatedEvent(await this.matrix()));
  }

  async matrix(): Promise<IWgMeshMatrix> {
    const nodes = await this._allNodes();
    const known = new Set(nodes.map(node => node.id));
    const cells: IWgMeshCell[] = [];

    for (const from of nodes) {
      const mesh = await this._live.getJson<IStoredMesh>(meshKey(from.id));

      for (const [toNodeId, probe] of Object.entries(mesh?.probes ?? {})) {
        if (!known.has(toNodeId)) continue;
        cells.push({
          fromNodeId: from.id,
          toNodeId,
          rttMs: probe.rttMs,
          lossPercent: probe.lossPercent,
          ts: mesh!.ts,
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
