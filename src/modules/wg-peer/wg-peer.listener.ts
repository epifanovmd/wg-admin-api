import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { WG_OVERVIEW_ROOM } from "../wg-node";
import {
  WgPeerCreatedEvent,
  WgPeerDeletedEvent,
  WgPeerUpdatedEvent,
} from "./events";
import { wgPeerRoom } from "./wg-peer-room.policy";

/**
 * Изменения пиров — подписчикам комнат и держателю (его «Мои пиры»
 * обновляются на всех устройствах).
 */
@Injectable()
export class WgPeerListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgPeerCreatedEvent, ({ peer }) => this._send(peer));
    this._eventBus.on(WgPeerUpdatedEvent, ({ peer }) => this._send(peer));
    this._eventBus.on(WgPeerDeletedEvent, ({ peerId, userId }) => {
      this._emitter.toRoom(wgPeerRoom(peerId), "wg:peer:deleted", {
        id: peerId,
      });
      this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:peer:deleted", { id: peerId });
      if (userId) {
        this._emitter.toUser(userId, "wg:peer:deleted", { id: peerId });
      }
    });
  }

  private _send(peer: WgPeerUpdatedEvent["peer"]): void {
    this._emitter.toRoom(wgPeerRoom(peer.id), "wg:peer:updated", peer);
    this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:peer:updated", peer);
    if (peer.userId) {
      this._emitter.toUser(peer.userId, "wg:peer:updated", peer);
    }
  }
}
