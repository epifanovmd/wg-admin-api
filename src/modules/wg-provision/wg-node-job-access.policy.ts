import { inject } from "inversify";

import {
  AccessService,
  IJobAccessPolicy,
  Injectable,
  JobAccessAction,
} from "../../core";
import { WgNodeAccess, WgNodePermissions, WgNodeRepository } from "../wg-node";
import { WG_NODE_JOB_SCOPE } from "./wg-provision.types";

/**
 * Задачи ноды (установка агента) видят все с правом просмотра ноды, отменяют —
 * с правом установки, а не только тот, кто запустил. С областью «свои» —
 * только задачи своих нод (владелец или создатель).
 */
@Injectable()
export class WgNodeJobAccessPolicy implements IJobAccessPolicy {
  readonly scopeType = WG_NODE_JOB_SCOPE;

  constructor(
    @inject(AccessService) private readonly _access: AccessService,
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
  ) {}

  async canAccess(userId: string, nodeId: string, action: JobAccessAction) {
    const scope = await this._access.scope(
      userId,
      action === "view"
        ? WgNodePermissions.NODE_VIEW
        : WgNodePermissions.NODE_PROVISION,
    );

    if (scope === "all") return true;
    if (scope !== "own") return false;

    const node = await this._nodes.findOne({ where: { id: nodeId } });

    return node !== null && WgNodeAccess.isOwn(userId, node);
  }
}
