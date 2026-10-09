import { inject } from "inversify";

import { Injectable, resolveScope } from "../../core";
import type { IAgentAccessPolicy, IAgentActor, TAgentAction } from "../agent";
import { WgNodeAccess } from "./wg-node.access";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeRepository } from "./wg-node.repository";

/** Право ноды, открывающее действие с её агентом. */
const NODE_PERMISSION: Record<TAgentAction, string> = {
  view: WgNodePermissions.NODE_VIEW,
  logs: WgNodePermissions.NODE_LOGS,
  manage: WgNodePermissions.NODE_AGENT,
  config: WgNodePermissions.NODE_AGENT,
  fetch: WgNodePermissions.NODE_AGENT,
};

/**
 * Доступ к агентам через ноды: агент ноды доступен с правом ноды на
 * действие (`wg:node:view`, `wg:node:logs`, `wg:node:agent`) — на все ноды
 * или на свои (`:own`, владелец или создатель).
 */
@Injectable()
export class WgNodeAgentAccessPolicy implements IAgentAccessPolicy {
  constructor(
    @inject(WgNodeRepository) private readonly _nodes: WgNodeRepository,
  ) {}

  async canAccess(
    actor: IAgentActor,
    agentId: string,
    action: TAgentAction,
  ): Promise<boolean> {
    const scope = this._scope(actor, action);

    if (!scope) return false;

    const node = await this._nodes.findByAgentId(agentId);

    return (
      node !== null &&
      (scope === "all" || WgNodeAccess.isOwn(actor.userId, node))
    );
  }

  async agentIds(actor: IAgentActor, action: TAgentAction): Promise<string[]> {
    const scope = this._scope(actor, action);

    if (!scope) return [];

    return this._nodes.findAgentIds(scope === "own" ? actor.userId : undefined);
  }

  private _scope(actor: IAgentActor, action: TAgentAction) {
    return resolveScope(
      actor.roles,
      actor.permissions,
      NODE_PERMISSION[action],
    );
  }
}
