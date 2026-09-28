import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import {
  ISocketEventListener,
  SocketEmitterService,
  SocketRoomService,
} from "../socket";
import type { WgPeerDto } from "./dto";
import {
  WgPeerCreatedEvent,
  WgPeerDeletedEvent,
  WgPeerUpdatedEvent,
} from "./events";
import { wgPeerRoom } from "./wg-peer-room.policy";

/** Комната списка пиров: право `wg:peer:view`. */
export const WG_PEERS_ROOM = "wg-peers";

/**
 * Изменения пиров — в комнату списка, комнату пира и держателю (его «Мои
 * пиры» обновляются на всех устройствах). Прежний держатель получает
 * `wg:peer:deleted` и теряет подписку на комнату пира.
 */
@Injectable()
export class WgPeerListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(SocketRoomService) private readonly _rooms: SocketRoomService,
  ) {}

  register(): void {
    this._eventBus.on(WgPeerCreatedEvent, ({ peer }) => this._send(peer));
    this._eventBus.on(WgPeerUpdatedEvent, ({ peer, previousUserId }) => {
      this._send(peer);
      if (previousUserId) return this._detach(peer.id, previousUserId);
    });
    this._eventBus.on(WgPeerDeletedEvent, ({ peerId, userId }) => {
      const payload = { id: peerId };

      this._emitter.toRoom(WG_PEERS_ROOM, "wg:peer:deleted", payload);
      this._emitter.toRoom(wgPeerRoom(peerId), "wg:peer:deleted", payload);
      if (userId) this._emitter.toUser(userId, "wg:peer:deleted", payload);
    });
  }

  private _send(peer: WgPeerDto): void {
    this._emitter.toRoom(WG_PEERS_ROOM, "wg:peer:updated", peer);
    this._emitter.toRoom(wgPeerRoom(peer.id), "wg:peer:updated", peer);
    if (peer.userId) {
      this._emitter.toUser(peer.userId, "wg:peer:updated", peer);
    }
  }

  /** Пир ушёл от держателя: убрать у него из списков и из комнаты пира. */
  private async _detach(peerId: string, userId: string): Promise<void> {
    this._emitter.toUser(userId, "wg:peer:deleted", { id: peerId });

    try {
      await this._rooms.revalidateUser(userId);
    } catch (err) {
      logger.error(
        { err, peerId, userId },
        "[WG] rooms of the previous peer holder not revalidated",
      );
    }
  }
}
