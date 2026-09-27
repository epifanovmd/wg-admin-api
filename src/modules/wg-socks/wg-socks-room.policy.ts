import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgAccessService } from "../wg-node";
import { WgSocksPermissions } from "./wg-socks.permissions";

export const WG_SOCKS_ROOM = "wg-socks";

/** Комната списка прокси: право `wg:socks:view`. */
@Injectable()
export class WgSocksRoomPolicy implements ISocketRoomPolicy {
  readonly type = WG_SOCKS_ROOM;

  constructor(
    @inject(WgAccessService) private readonly _access: WgAccessService,
  ) {}

  room(): string {
    return WG_SOCKS_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgSocksPermissions.SOCKS_VIEW);
  }
}
