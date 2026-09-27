import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WG_OVERVIEW_ROOM, WgAccessService } from "../wg-node";
import { WgStatsPermissions } from "./wg-stats.permissions";

/** Комната сводки дашборда: право `wg:stats:view`. */
@Injectable()
export class WgOverviewRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-overview";

  constructor(
    @inject(WgAccessService) private readonly _access: WgAccessService,
  ) {}

  room(): string {
    return WG_OVERVIEW_ROOM;
  }

  canJoin(userId: string): Promise<boolean> {
    return this._access.can(userId, WgStatsPermissions.STATS_VIEW);
  }
}
