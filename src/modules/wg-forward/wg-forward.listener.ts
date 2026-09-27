import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { WgForwardDeletedEvent, WgForwardUpdatedEvent } from "./events";
import { WG_FORWARDS_ROOM } from "./wg-forward-room.policy";

/** Изменения пробросов и их маршрутов — подписчикам комнаты списка. */
@Injectable()
export class WgForwardListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgForwardUpdatedEvent, ({ forward }) =>
      this._emitter.toRoom(WG_FORWARDS_ROOM, "wg:forward:updated", forward),
    );
    this._eventBus.on(WgForwardDeletedEvent, ({ forwardId }) =>
      this._emitter.toRoom(WG_FORWARDS_ROOM, "wg:forward:deleted", {
        id: forwardId,
      }),
    );
  }
}
