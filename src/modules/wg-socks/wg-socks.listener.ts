import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import {
  WgSocksDeletedEvent,
  WgSocksStatsEvent,
  WgSocksUpdatedEvent,
} from "./events";
import { WG_SOCKS_ROOM } from "./wg-socks-room.policy";

/** Изменения прокси и их статистика — подписчикам комнаты списка. */
@Injectable()
export class WgSocksListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgSocksUpdatedEvent, ({ service }) =>
      this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:updated", service),
    );
    this._eventBus.on(WgSocksDeletedEvent, ({ serviceId }) =>
      this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:deleted", {
        id: serviceId,
      }),
    );
    this._eventBus.on(WgSocksStatsEvent, ({ serviceId, live }) =>
      this._emitter.toRoom(WG_SOCKS_ROOM, "wg:socks:stats", {
        id: serviceId,
        live,
      }),
    );
  }
}
