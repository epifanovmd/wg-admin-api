import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import {
  WgSocksDeletedEvent,
  WgSocksStatsEvent,
  WgSocksUpdatedEvent,
} from "./events";
import { WgSocksPermissions } from "./wg-socks.permissions";
import { WG_SOCKS_ROOM } from "./wg-socks-room.policy";

/**
 * Изменения прокси и их статистика — в комнату списка и своим (владельцу и
 * создателю с областью «только свои»). Прежний владелец, для которого прокси
 * больше не свой, получает `wg:socks:deleted`.
 */
@Injectable()
export class WgSocksListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
  ) {}

  register(): void {
    this._eventBus.on(
      WgSocksUpdatedEvent,
      async ({ service, previousOwnerId }) => {
        this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:updated", service);
        await this._owned.toOwners(
          [service.ownerId, service.createdById],
          WgSocksPermissions.SOCKS_VIEW,
          "wg:socks:updated",
          service,
        );
        if (previousOwnerId && previousOwnerId !== service.createdById) {
          await this._owned.detach(previousOwnerId, "wg:socks:deleted", {
            id: service.id,
          });
        }
      },
    );
    this._eventBus.on(
      WgSocksDeletedEvent,
      ({ serviceId, ownerId, createdById }) => {
        const payload = { id: serviceId };

        this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:deleted", payload);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgSocksPermissions.SOCKS_VIEW,
          "wg:socks:deleted",
          payload,
        );
      },
    );
    this._eventBus.on(
      WgSocksStatsEvent,
      ({ serviceId, live, ownerId, createdById }) => {
        const payload = { id: serviceId, live };

        this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:stats", payload);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgSocksPermissions.SOCKS_VIEW,
          "wg:socks:stats",
          payload,
        );
      },
    );
  }
}
