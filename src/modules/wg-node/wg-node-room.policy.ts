import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgAccessService } from "./wg-access.service";
import { WgNodePermissions } from "./wg-node.permissions";

export const wgNodeRoom = (id: string): string => `wg-node_${id}`;

/** Комната ноды: статусы, метрики — право `wg:node:view`. */
@Injectable()
export class WgNodeRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-node";

  constructor(
    @inject(WgAccessService) private readonly _access: WgAccessService,
  ) {}

  room(id: string): string {
    return wgNodeRoom(id);
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgNodePermissions.NODE_VIEW);
  }
}
