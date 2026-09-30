import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import type { WgEndpointDto } from "./dto";
import {
  WgEndpointChangedEvent,
  WgEndpointCreatedEvent,
  WgEndpointDeletedEvent,
  WgEndpointInterfacesChangedEvent,
} from "./events";
import { WgEndpointPermissions } from "./wg-endpoint.permissions";
import { WG_ENDPOINTS_ROOM } from "./wg-endpoint-room.policy";

/**
 * Изменения точек подключения — в комнату списка и своим (владельцу и
 * создателю с областью «только свои»). Прежний владелец, для которого точка
 * больше не своя, получает `wg:endpoint:deleted`.
 */
@Injectable()
export class WgEndpointListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
  ) {}

  register(): void {
    this._eventBus.on(WgEndpointCreatedEvent, ({ endpoint }) =>
      this._send(endpoint),
    );
    this._eventBus.on(
      WgEndpointChangedEvent,
      async ({ endpoint, previousOwnerId }) => {
        await this._send(endpoint);
        if (previousOwnerId && previousOwnerId !== endpoint.createdById) {
          await this._owned.detach(previousOwnerId, "wg:endpoint:deleted", {
            id: endpoint.id,
          });
        }
      },
    );
    this._eventBus.on(WgEndpointInterfacesChangedEvent, ({ endpoint }) =>
      this._send(endpoint),
    );
    this._eventBus.on(
      WgEndpointDeletedEvent,
      ({ endpointId, ownerId, createdById }) => {
        const payload = { id: endpointId };

        this._emitter.toRoom(WG_ENDPOINTS_ROOM, "wg:endpoint:deleted", payload);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgEndpointPermissions.ENDPOINT_VIEW,
          "wg:endpoint:deleted",
          payload,
        );
      },
    );
  }

  private _send(endpoint: WgEndpointDto): Promise<void> {
    this._emitter.toRoom(WG_ENDPOINTS_ROOM, "wg:endpoint:updated", endpoint);

    return this._owned.toOwners(
      [endpoint.ownerId, endpoint.createdById],
      WgEndpointPermissions.ENDPOINT_VIEW,
      "wg:endpoint:updated",
      endpoint,
    );
  }
}
