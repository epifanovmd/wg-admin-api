import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import type { WgPeerDto } from "./dto";
import {
  WgPeerCreatedEvent,
  WgPeerDeletedEvent,
  WgPeerUpdatedEvent,
} from "./events";
import { WgPeerPermissions } from "./wg-peer.permissions";
import { wgPeerRoom } from "./wg-peer-room.policy";

/** Комната списка пиров: право `wg:peer:view` на все пиры. */
export const WG_PEERS_ROOM = "wg-peers";

/**
 * Изменения пиров — в комнату списка, комнату пира и своим (держателю и
 * создателю с областью «только свои»). Прежний держатель, для которого пир
 * больше не свой, получает `wg:peer:deleted` и теряет подписку на комнату пира.
 */
@Injectable()
export class WgPeerListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
  ) {}

  register(): void {
    this._eventBus.on(WgPeerCreatedEvent, ({ peer }) => this._send(peer));
    this._eventBus.on(WgPeerUpdatedEvent, async ({ peer, previousUserId }) => {
      await this._send(peer);
      if (previousUserId && previousUserId !== peer.createdById) {
        await this._owned.detach(previousUserId, "wg:peer:deleted", {
          id: peer.id,
        });
      }
    });
    this._eventBus.on(WgPeerDeletedEvent, ({ peerId, userId, createdById }) => {
      const payload = { id: peerId };

      this._emitter.toRoom(WG_PEERS_ROOM, "wg:peer:deleted", payload);
      this._emitter.toRoom(wgPeerRoom(peerId), "wg:peer:deleted", payload);

      return this._owned.toOwners(
        [userId, createdById],
        WgPeerPermissions.PEER_VIEW,
        "wg:peer:deleted",
        payload,
      );
    });
  }

  private _send(peer: WgPeerDto): Promise<void> {
    this._emitter.toRoom(WG_PEERS_ROOM, "wg:peer:updated", peer);
    this._emitter.toRoom(wgPeerRoom(peer.id), "wg:peer:updated", peer);

    return this._owned.toOwners(
      [peer.userId, peer.createdById],
      WgPeerPermissions.PEER_VIEW,
      "wg:peer:updated",
      peer,
    );
  }
}
