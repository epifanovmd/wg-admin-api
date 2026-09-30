import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgNodeAccess } from "./wg-node.access";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeRepository } from "./wg-node.repository";

export const wgNodeRoom = (id: string): string => `wg-node_${id}`;

/**
 * Комната ноды: статусы, метрики, туннели, задачи установки — право на все
 * ноды либо своя нода (владелец или создатель) с правом `wg:node:view:own`.
 */
@Injectable()
export class WgNodeRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-node";

  constructor(
    @inject(AccessService) private readonly _access: AccessService,
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
  ) {}

  room(id: string): string {
    return wgNodeRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    const scope = await this._access.scope(userId, WgNodePermissions.NODE_VIEW);

    if (scope === "all") return true;
    if (scope !== "own") return false;

    const node = await this._nodes.findOne({ where: { id } });

    return node !== null && WgNodeAccess.isOwn(userId, node);
  }
}
