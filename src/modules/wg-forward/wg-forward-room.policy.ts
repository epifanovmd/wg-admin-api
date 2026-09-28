import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgForwardPermissions } from "./wg-forward.permissions";

export const WG_FORWARDS_ROOM = "wg-forwards";

/** Комната списка пробросов: право `wg:forward:view`. */
@Injectable()
export class WgForwardsRoomPolicy implements ISocketRoomPolicy {
  readonly type = WG_FORWARDS_ROOM;

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(): string {
    return WG_FORWARDS_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgForwardPermissions.FORWARD_VIEW);
  }
}
