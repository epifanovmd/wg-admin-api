import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import type { WgNodeDto } from "./dto";
import {
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeStatusChangedEvent,
  WgNodeUpdatedEvent,
} from "./events";
import { wgNodeRoom } from "./wg-node-room.policy";

/** Комната overview дашборда (статистика) — объявлена в модуле wg-stats. */
export const WG_OVERVIEW_ROOM = "wg-overview";

/** Комната списка нод: право `wg:node:view`. */
export const WG_NODES_ROOM = "wg-nodes";

/** Изменения нод — в комнату списка нод и в комнату самой ноды. */
@Injectable()
export class WgNodeListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(WgNodeCreatedEvent, ({ node }) =>
      this._emitter.toRoom(WG_NODES_ROOM, "wg:node:updated", node),
    );
    this._eventBus.on(WgNodeUpdatedEvent, ({ node }) => this._sendNode(node));
    this._eventBus.on(WgNodeStatusChangedEvent, ({ node }) =>
      this._sendNode(node),
    );
    this._eventBus.on(WgNodeDeletedEvent, ({ nodeId }) => {
      const payload = { id: nodeId };

      this._emitter.toRoom(WG_NODES_ROOM, "wg:node:deleted", payload);
      this._emitter.toRoom(wgNodeRoom(nodeId), "wg:node:deleted", payload);
    });
  }

  private _sendNode(node: WgNodeDto): void {
    this._emitter.toRoom(WG_NODES_ROOM, "wg:node:updated", node);
    this._emitter.toRoom(wgNodeRoom(node.id), "wg:node:updated", node);
  }
}
