import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { wgInterfaceRoom } from "../wg-interface";
import { WG_OVERVIEW_ROOM, wgNodeRoom } from "../wg-node";
import { wgOwnPeersRoom, wgPeerRoom } from "../wg-peer";
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

/** Сгруппировать по ключу с сохранением порядка. */
const groupBy = <T>(items: T[], key: (item: T) => string | null) => {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const value = key(item);

    if (value) groups.set(value, [...(groups.get(value) ?? []), item]);
  }

  return groups;
};

/** Live-статистика — подписчикам комнат. */
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
    this._eventBus.on(WgPeersLiveStatsEvent, ({ lives }) =>
      this._sendPeers(lives),
    );
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

  /**
   * Статистика пиров за тик — одним событием `wg:peers:stats` на получателя:
   * комнате обзора — все пиры, комнате интерфейса — его пиры, комнате «мои
   * пиры» — пиры держателя, комнате пира — только он. Участники комнаты
   * обзора уже получили весь тик и из остальных рассылок исключаются;
   * держатель со списком своих пиров не получает пира ещё раз из его комнаты.
   */
  private _sendPeers(lives: IWgPeerLive[]): void {
    const except = WG_OVERVIEW_ROOM;

    this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:peers:stats", { peers: lives });
    for (const [interfaceId, peers] of groupBy(lives, l => l.interfaceId)) {
      this._emitter.toRoomExcept(
        wgInterfaceRoom(interfaceId),
        except,
        "wg:peers:stats",
        { peers },
      );
    }
    for (const [userId, peers] of groupBy(lives, l => l.userId)) {
      this._emitter.toRoomExcept(
        wgOwnPeersRoom(userId),
        except,
        "wg:peers:stats",
        { peers },
      );
    }
    for (const live of lives) {
      this._emitter.toRoomExcept(
        wgPeerRoom(live.peerId),
        live.userId ? [except, wgOwnPeersRoom(live.userId)] : except,
        "wg:peers:stats",
        { peers: [live] },
      );
    }
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
