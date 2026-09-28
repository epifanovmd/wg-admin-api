import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgEndpointPermissions } from "./wg-endpoint.permissions";

export const WG_ENDPOINTS_ROOM = "wg-endpoints";

/** Комната списка точек подключения: право `wg:endpoint:view`. */
@Injectable()
export class WgEndpointsRoomPolicy implements ISocketRoomPolicy {
  readonly type = WG_ENDPOINTS_ROOM;

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(): string {
    return WG_ENDPOINTS_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgEndpointPermissions.ENDPOINT_VIEW);
  }
}
