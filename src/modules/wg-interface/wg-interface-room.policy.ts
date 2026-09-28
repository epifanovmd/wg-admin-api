import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgInterfacePermissions } from "./wg-interface.permissions";

export const wgInterfaceRoom = (id: string): string => `wg-interface_${id}`;

/** Комната интерфейса: статус и live-статистика — право `wg:interface:view`. */
@Injectable()
export class WgInterfaceRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-interface";

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(id: string): string {
    return wgInterfaceRoom(id);
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgInterfacePermissions.INTERFACE_VIEW);
  }
}
