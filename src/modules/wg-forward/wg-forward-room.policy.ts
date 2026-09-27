import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgAccessService } from "../wg-node";
import { WgForwardPermissions } from "./wg-forward.permissions";

export const WG_FORWARDS_ROOM = "wg-forwards";

/** Комната списка пробросов: право `wg:forward:view`. */
@Injectable()
export class WgForwardsRoomPolicy implements ISocketRoomPolicy {
  readonly type = WG_FORWARDS_ROOM;

  constructor(
    @inject(WgAccessService) private readonly _access: WgAccessService,
  ) {}

  room(): string {
    return WG_FORWARDS_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgForwardPermissions.FORWARD_VIEW);
  }
}
