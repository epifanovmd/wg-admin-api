import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WG_OVERVIEW_ROOM } from "../wg-node";
import { WgStatsPermissions } from "./wg-stats.permissions";

/** Комната сводки дашборда: право `wg:stats:view`. */
@Injectable()
export class WgOverviewRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-overview";

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(): string {
    return WG_OVERVIEW_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgStatsPermissions.STATS_VIEW);
  }
}
