import { inject } from "inversify";
import { In } from "typeorm";

import { EventBus, Injectable } from "../../core";
import { WgEndpointService } from "../wg-endpoint";
import { WgNodeRepository } from "../wg-node";
import { WgLinksProbedEvent } from "./events";
import { WgLiveStore } from "./wg-live-store.service";
import {
  EWgLinkRole,
  EWgLinkStatus,
  IWgLinkHealth,
  IWgTunnelProbe,
} from "./wg-stats.types";

/** Проба живёт дольше интервала агента (10 с) с запасом на пропуски. */
const PROBE_TTL_SEC = 60;
const PROBE_FRESH_MS = 60_000;
const TUNNEL_NAME = /^wgt(\d+)$/;

interface IStoredProbe {
  rttMs: number | null;
  lossPercent: number;
  ts: string;
}

const probeKey = (linkId: string, role: EWgLinkRole): string =>
  `link:${linkId}:${role}`;

/** Статус линка по последней пробе: нет свежей — unknown. */
export const linkHealthStatus = (
  probe: IStoredProbe | null,
  now: number,
): EWgLinkStatus => {
  if (!probe || now - Date.parse(probe.ts) > PROBE_FRESH_MS) {
    return EWgLinkStatus.Unknown;
  }
  if (probe.lossPercent >= 100) return EWgLinkStatus.Down;
  if (probe.lossPercent > 0) return EWgLinkStatus.Degraded;

  return EWgLinkStatus.Ok;
};

/**
 * Здоровье IPIP-линков релеев: агенты обеих сторон пингуют дальний конец
 * туннеля, последние пробы — в live-хранилище (общем для процессов).
 */
@Injectable()
export class WgLinkHealthService {
  constructor(
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
    @inject(WgEndpointService) private readonly _endpoints: WgEndpointService,
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** Принять пробы туннелей ноды; чужие и неизвестные туннели игнорируются. */
  async recordProbes(nodeId: string, probes: IWgTunnelProbe[]): Promise<void> {
    if (probes.length === 0) return;

    const links = await this._endpoints.linksForNode(nodeId);
    const byIndex = new Map(links.map(link => [link.tunnelIndex, link]));
    const ts = new Date().toISOString();
    // Проба видна обеим сторонам линка (встречная — запасная).
    const touched = new Set<string>();

    for (const probe of probes) {
      const index = probe.name.match(TUNNEL_NAME)?.[1];
      const link = index === undefined ? undefined : byIndex.get(Number(index));

      if (!link) continue;

      const role =
        link.relayNodeId === nodeId ? EWgLinkRole.Relay : EWgLinkRole.Target;
      const stored: IStoredProbe = {
        rttMs: probe.rttMs,
        lossPercent: probe.lossPercent,
        ts,
      };

      await this._live.setJson(probeKey(link.id, role), stored, PROBE_TTL_SEC);
      touched.add(link.relayNodeId).add(link.targetNodeId);
    }
    if (touched.size > 0) {
      this._eventBus.emit(new WgLinksProbedEvent([...touched]));
    }
  }

  /** Линки ноды в обеих ролях: проба своей стороны, иначе — встречной. */
  async forNode(nodeId: string): Promise<IWgLinkHealth[]> {
    const links = await this._endpoints.linksForNode(nodeId);

    if (links.length === 0) return [];

    const counterpartIds = links.map(link =>
      link.relayNodeId === nodeId ? link.targetNodeId : link.relayNodeId,
    );
    const nodes = await this._nodes.find({
      where: { id: In(counterpartIds) },
      select: { id: true, name: true },
    });
    const names = new Map(nodes.map(node => [node.id, node.name]));
    const now = Date.now();

    return Promise.all(
      links.map(async link => {
        const role =
          link.relayNodeId === nodeId ? EWgLinkRole.Relay : EWgLinkRole.Target;
        const other =
          role === EWgLinkRole.Relay ? EWgLinkRole.Target : EWgLinkRole.Relay;
        const probe =
          (await this._live.getJson<IStoredProbe>(probeKey(link.id, role))) ??
          (await this._live.getJson<IStoredProbe>(probeKey(link.id, other)));
        const counterpartNodeId =
          role === EWgLinkRole.Relay ? link.targetNodeId : link.relayNodeId;

        return {
          linkId: link.id,
          role,
          counterpartNodeId,
          counterpartName: names.get(counterpartNodeId) ?? null,
          tunnelName: `wgt${link.tunnelIndex}`,
          rttMs: probe?.rttMs ?? null,
          lossPercent: probe?.lossPercent ?? null,
          status: linkHealthStatus(probe, now),
          ts: probe?.ts ?? null,
        };
      }),
    );
  }
}
