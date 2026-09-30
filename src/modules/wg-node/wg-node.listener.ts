import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import type { WgNodeDto } from "./dto";
import {
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeStatusChangedEvent,
  WgNodeUpdatedEvent,
} from "./events";
import { WgNodePermissions } from "./wg-node.permissions";
import { wgNodeRoom } from "./wg-node-room.policy";

/** Комната overview дашборда (статистика) — объявлена в модуле wg-stats. */
export const WG_OVERVIEW_ROOM = "wg-overview";

/** Комната списка нод: право `wg:node:view` на все ноды. */
export const WG_NODES_ROOM = "wg-nodes";

/**
 * Изменения нод — в комнату списка, комнату ноды и своим (владельцу и
 * создателю с областью «только свои»). Прежний владелец, для которого нода
 * больше не своя, получает `wg:node:deleted` и теряет подписку на её комнату.
 */
@Injectable()
export class WgNodeListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
  ) {}

  register(): void {
    this._eventBus.on(WgNodeCreatedEvent, ({ node }) => {
      this._emitter.toRoom(WG_NODES_ROOM, "wg:node:updated", node);

      return this._toOwners(node);
    });
    this._eventBus.on(WgNodeUpdatedEvent, async ({ node, previousOwnerId }) => {
      await this._sendNode(node);
      if (previousOwnerId && previousOwnerId !== node.createdById) {
        await this._owned.detach(previousOwnerId, "wg:node:deleted", {
          id: node.id,
        });
      }
    });
    this._eventBus.on(WgNodeStatusChangedEvent, ({ node }) =>
      this._sendNode(node),
    );
    this._eventBus.on(
      WgNodeDeletedEvent,
      ({ nodeId, ownerId, createdById }) => {
        const payload = { id: nodeId };

        this._emitter.toRoom(WG_NODES_ROOM, "wg:node:deleted", payload);
        this._emitter.toRoom(wgNodeRoom(nodeId), "wg:node:deleted", payload);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgNodePermissions.NODE_VIEW,
          "wg:node:deleted",
          payload,
        );
      },
    );
  }

  private _sendNode(node: WgNodeDto): Promise<void> {
    this._emitter.toRoom(WG_NODES_ROOM, "wg:node:updated", node);
    this._emitter.toRoom(wgNodeRoom(node.id), "wg:node:updated", node);

    return this._toOwners(node);
  }

  private _toOwners(node: WgNodeDto): Promise<void> {
    return this._owned.toOwners(
      [node.ownerId, node.createdById],
      WgNodePermissions.NODE_VIEW,
      "wg:node:updated",
      node,
    );
  }
}
