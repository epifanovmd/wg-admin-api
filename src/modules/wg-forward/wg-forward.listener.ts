import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import { WgForwardDeletedEvent, WgForwardUpdatedEvent } from "./events";
import { WgForwardPermissions } from "./wg-forward.permissions";
import { WG_FORWARDS_ROOM } from "./wg-forward-room.policy";

/**
 * Изменения пробросов и их маршрутов — в комнату списка и своим (владельцу и
 * создателю с областью «только свои»). Прежний владелец, для которого проброс
 * больше не свой, получает `wg:forward:deleted`.
 */
@Injectable()
export class WgForwardListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
  ) {}

  register(): void {
    this._eventBus.on(
      WgForwardUpdatedEvent,
      async ({ forward, previousOwnerId }) => {
        this._emitter.toRoom(WG_FORWARDS_ROOM, "wg:forward:updated", forward);
        await this._owned.toOwners(
          [forward.ownerId, forward.createdById],
          WgForwardPermissions.FORWARD_VIEW,
          "wg:forward:updated",
          forward,
        );
        if (previousOwnerId && previousOwnerId !== forward.createdById) {
          await this._owned.detach(previousOwnerId, "wg:forward:deleted", {
            id: forward.id,
          });
        }
      },
    );
    this._eventBus.on(
      WgForwardDeletedEvent,
      ({ forwardId, ownerId, createdById }) => {
        const payload = { id: forwardId };

        this._emitter.toRoom(WG_FORWARDS_ROOM, "wg:forward:deleted", payload);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgForwardPermissions.FORWARD_VIEW,
          "wg:forward:deleted",
          payload,
        );
      },
    );
  }
}
