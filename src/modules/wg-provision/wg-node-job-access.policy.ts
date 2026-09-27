import { inject } from "inversify";

import { IJobAccessPolicy, Injectable, JobAccessAction } from "../../core";
import { WgAccessService, WgNodePermissions } from "../wg-node";
import { WG_NODE_JOB_SCOPE } from "./wg-provision.types";

/**
 * Задачи ноды (установка агента) видят все с `wg:node:view`, отменяют —
 * с `wg:node:provision`, а не только тот, кто запустил.
 */
@Injectable()
export class WgNodeJobAccessPolicy implements IJobAccessPolicy {
  readonly scopeType = WG_NODE_JOB_SCOPE;

  constructor(
    @inject(WgAccessService) private readonly _access: WgAccessService,
  ) {}

  canAccess(userId: string, _nodeId: string, action: JobAccessAction) {
    return this._access.can(
      userId,
      action === "view"
        ? WgNodePermissions.NODE_VIEW
        : WgNodePermissions.NODE_PROVISION,
    );
  }
}
