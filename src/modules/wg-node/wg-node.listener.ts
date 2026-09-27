import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { WgNodeStatusChangedEvent, WgNodeUpdatedEvent } from "./events";
import { wgNodeRoom } from "./wg-node-room.policy";

/** Комната overview дашборда — объявлена в модуле wg-stats. */
export const WG_OVERVIEW_ROOM = "wg-overview";

/** Состояние нод — подписчикам комнат: в комнату ноды и в overview. */
@Injectable()
export class WgNodeListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgNodeStatusChangedEvent, ({ node }) =>
      this._sendNode(node),
    );
    this._eventBus.on(WgNodeUpdatedEvent, ({ node }) => this._sendNode(node));
  }

  private _sendNode(node: WgNodeStatusChangedEvent["node"]): void {
    this._emitter.toRoom(wgNodeRoom(node.id), "wg:node:updated", node);
    this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:node:updated", node);
  }
}
