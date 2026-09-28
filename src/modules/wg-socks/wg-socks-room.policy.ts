import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgSocksPermissions } from "./wg-socks.permissions";

export const WG_SOCKS_ROOM = "wg-socks";

/** Комната списка прокси: право `wg:socks:view`. */
@Injectable()
export class WgSocksRoomPolicy implements ISocketRoomPolicy {
  readonly type = WG_SOCKS_ROOM;

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(): string {
    return WG_SOCKS_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgSocksPermissions.SOCKS_VIEW);
  }
}
