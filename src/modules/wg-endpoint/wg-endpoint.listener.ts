import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import {
  WgEndpointChangedEvent,
  WgEndpointCreatedEvent,
  WgEndpointDeletedEvent,
} from "./events";
import { WG_ENDPOINTS_ROOM } from "./wg-endpoint-room.policy";

/** Изменения точек подключения — подписчикам комнаты списка. */
@Injectable()
export class WgEndpointListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgEndpointCreatedEvent, ({ endpoint }) =>
      this._emitter.toRoom(WG_ENDPOINTS_ROOM, "wg:endpoint:updated", endpoint),
    );
    this._eventBus.on(WgEndpointChangedEvent, ({ endpoint }) =>
      this._emitter.toRoom(WG_ENDPOINTS_ROOM, "wg:endpoint:updated", endpoint),
    );
    this._eventBus.on(WgEndpointDeletedEvent, ({ endpointId }) =>
      this._emitter.toRoom(WG_ENDPOINTS_ROOM, "wg:endpoint:deleted", {
        id: endpointId,
      }),
    );
  }
}
