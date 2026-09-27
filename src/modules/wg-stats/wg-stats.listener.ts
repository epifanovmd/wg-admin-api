import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { wgInterfaceRoom } from "../wg-interface";
import { WG_OVERVIEW_ROOM, wgNodeRoom } from "../wg-node";
import { wgPeerRoom } from "../wg-peer";
import {
  WgInterfaceLiveStatsEvent,
  WgLinksProbedEvent,
  WgMeshUpdatedEvent,
  WgNodeLiveStatsEvent,
  WgOverviewUpdatedEvent,
  WgPeersLiveStatsEvent,
} from "./events";
import { WgLinkHealthService } from "./wg-link-health.service";
import type { IWgPeerLive } from "./wg-stats.types";

/** Live-статистика — подписчикам комнат; пир — ещё и держателю. */
@Injectable()
export class WgStatsListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(WgLinkHealthService)
    private readonly _links: WgLinkHealthService,
  ) {}

  register(): void {
    this._eventBus.on(WgPeersLiveStatsEvent, ({ lives }) => {
      const byInterface = new Map<string, IWgPeerLive[]>();

      for (const live of lives) {
        this._emitter.toRoom(wgPeerRoom(live.peerId), "wg:peer:stats", live);
        if (live.userId) {
          this._emitter.toUser(live.userId, "wg:peer:stats", live);
        }
        byInterface.set(live.interfaceId, [
          ...(byInterface.get(live.interfaceId) ?? []),
          live,
        ]);
      }
      // Таблицы пиров: страница интерфейса и общий список — одной пачкой.
      for (const [interfaceId, peers] of byInterface) {
        this._emitter.toRoom(wgInterfaceRoom(interfaceId), "wg:peers:stats", {
          peers,
        });
      }
      this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:peers:stats", {
        peers: lives,
      });
    });
    this._eventBus.on(WgInterfaceLiveStatsEvent, ({ live }) =>
      this._emitter.toRoom(
        wgInterfaceRoom(live.interfaceId),
        "wg:interface:stats",
        live,
      ),
    );
    this._eventBus.on(WgNodeLiveStatsEvent, ({ live }) => {
      this._emitter.toRoom(wgNodeRoom(live.nodeId), "wg:node:stats", live);
      this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:node:stats", live);
    });
    this._eventBus.on(WgOverviewUpdatedEvent, ({ overview }) =>
      this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:stats:overview", overview),
    );
    this._eventBus.on(WgMeshUpdatedEvent, ({ matrix }) =>
      this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:stats:mesh", matrix),
    );
    this._eventBus.on(WgLinksProbedEvent, ({ nodeIds }) =>
      this._sendLinks(nodeIds),
    );
  }

  /** Линки каждой затронутой ноды — в её комнату (с её точки зрения). */
  private async _sendLinks(nodeIds: string[]): Promise<void> {
    for (const nodeId of nodeIds) {
      try {
        this._emitter.toRoom(wgNodeRoom(nodeId), "wg:node:links", {
          nodeId,
          links: await this._links.forNode(nodeId),
        });
      } catch (err) {
        logger.error({ err, nodeId }, "[WG] node links not sent");
      }
    }
  }
}
