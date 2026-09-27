import { inject } from "inversify";

import { hasPermission, Injectable } from "../../core";
import { isSuperUser } from "../../core/auth/user-context";
import type { AuthContext } from "../../types/koa";
import { WgInterfaceRepository } from "../wg-interface";
import { EWgNodeStatus, WgNodeRepository } from "../wg-node";
import { WgPeerRepository } from "../wg-peer";
import { WgLiveStore } from "./wg-live-store.service";
import { WgStatsError } from "./wg-stats.errors";
import { WgStatsPermissions } from "./wg-stats.permissions";
import {
  IWgInterfaceLive,
  IWgNodeLive,
  IWgOverview,
  IWgPeerLive,
  IWgSpeedPoint,
} from "./wg-stats.types";

interface ICachedCounts {
  expiresAt: number;
  nodes: { total: number; online: number };
  interfaces: { total: number; enabled: number };
  peers: { total: number; enabled: number };
}

const COUNTS_TTL_MS = 30_000;
const LIVE_FRESH_MS = 30_000;

/** Сводка дашборда: глобальная (право view) и по своим пирам (право own). */
@Injectable()
export class WgStatsOverviewService {
  private _counts: ICachedCounts | null = null;

  constructor(
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgPeerRepository) private readonly _peers: WgPeerRepository,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
  ) {}

  canViewGlobal(actor: AuthContext): boolean {
    return (
      isSuperUser(actor) ||
      hasPermission(actor.permissions, WgStatsPermissions.STATS_VIEW)
    );
  }

  canViewOwn(actor: AuthContext): boolean {
    return hasPermission(actor.permissions, WgStatsPermissions.STATS_OWN);
  }

  async overviewFor(actor: AuthContext): Promise<IWgOverview> {
    if (this.canViewGlobal(actor)) return this.rebuildLiveOverview();
    if (this.canViewOwn(actor)) return this._ownOverview(actor.userId);

    throw WgStatsError.FORBIDDEN();
  }

  /** Пересобрать глобальную сводку из live-снимков нод и счётчиков БД. */
  async rebuildLiveOverview(): Promise<IWgOverview> {
    const counts = await this._cachedCounts();
    const nodeIds = await this._live.activeNodeIds();
    const now = Date.now();
    let rxTotal = 0;
    let txTotal = 0;
    let rxBps = 0;
    let txBps = 0;
    let peersOnline = 0;

    for (const nodeId of nodeIds) {
      const live = await this._live.getJson<IWgNodeLive>(`node:${nodeId}`);

      if (!live || now - Date.parse(live.ts) > LIVE_FRESH_MS) continue;

      rxTotal += live.rxTotal;
      txTotal += live.txTotal;
      rxBps += live.rxBps;
      txBps += live.txBps;
      peersOnline += live.peersOnline;
    }

    const overview: IWgOverview = {
      nodes: counts.nodes,
      interfaces: counts.interfaces,
      peers: { ...counts.peers, online: peersOnline },
      rxTotal,
      txTotal,
      rxBps,
      txBps,
      ts: new Date(now).toISOString(),
    };

    await this._live.setJson("overview", overview, 60);

    return overview;
  }

  /** Live-снимок пира/интерфейса/ноды из хранилища. */
  getPeerLive(peerId: string): Promise<IWgPeerLive | null> {
    return this._live.getJson<IWgPeerLive>(`peer:${peerId}`);
  }

  getInterfaceLive(interfaceId: string): Promise<IWgInterfaceLive | null> {
    return this._live.getJson<IWgInterfaceLive>(`iface:${interfaceId}`);
  }

  getNodeLive(nodeId: string): Promise<IWgNodeLive | null> {
    return this._live.getJson<IWgNodeLive>(`node:${nodeId}`);
  }

  /** Короткий ряд скорости (последние минуты), от старых точек к новым. */
  getSpeedWindow(
    kind: "node" | "iface" | "peer",
    id: string,
  ): Promise<IWgSpeedPoint[]> {
    return this._live.listRecent<IWgSpeedPoint>(`win:${kind}:${id}`);
  }

  /** Сводка по своим пирам держателя. */
  private async _ownOverview(userId: string): Promise<IWgOverview> {
    const peers = await this._peers.find({ where: { userId } });
    const now = Date.now();
    let online = 0;
    let rxTotal = 0;
    let txTotal = 0;
    let rxBps = 0;
    let txBps = 0;

    for (const peer of peers) {
      const live = await this._live.getJson<IWgPeerLive>(`peer:${peer.id}`);

      if (live && now - Date.parse(live.ts) <= LIVE_FRESH_MS) {
        rxTotal += live.rxTotal;
        txTotal += live.txTotal;
        rxBps += live.rxBps;
        txBps += live.txBps;
        if (live.online) online += 1;
      } else {
        rxTotal += peer.rxBytesTotal;
        txTotal += peer.txBytesTotal;
      }
    }

    return {
      nodes: { total: 0, online: 0 },
      interfaces: { total: 0, enabled: 0 },
      peers: {
        total: peers.length,
        enabled: peers.filter(peer => peer.enabled).length,
        online,
      },
      rxTotal,
      txTotal,
      rxBps,
      txBps,
      ts: new Date(now).toISOString(),
    };
  }

  private async _cachedCounts(): Promise<ICachedCounts> {
    if (this._counts && this._counts.expiresAt > Date.now()) {
      return this._counts;
    }

    const [
      nodesTotal,
      nodesOnline,
      interfacesTotal,
      interfacesEnabled,
      peersTotal,
      peersEnabled,
    ] = await Promise.all([
      this._nodes.count(),
      this._nodes.count({ where: { status: EWgNodeStatus.Online } }),
      this._interfaces.count(),
      this._interfaces.count({ where: { enabled: true } }),
      this._peers.count(),
      this._peers.count({ where: { enabled: true } }),
    ]);

    this._counts = {
      expiresAt: Date.now() + COUNTS_TTL_MS,
      nodes: { total: nodesTotal, online: nodesOnline },
      interfaces: { total: interfacesTotal, enabled: interfacesEnabled },
      peers: { total: peersTotal, enabled: peersEnabled },
    };

    return this._counts;
  }
}
