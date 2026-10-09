import { inject, multiInject, optional } from "inversify";

import type { TokenProvider } from "../../core";
import { AccessService, Injectable } from "../../core";
import { AgentError } from "./agent.errors";
import { AgentPermissions } from "./agent.permissions";

/** Действие над агентом: по нему выбирается право и решение политики. */
export type TAgentAction = "view" | "manage" | "config" | "fetch" | "logs";

/** Кто действует: id, роли и права (контекст запроса или права из БД). */
export interface IAgentActor {
  userId: string;
  roles: string[];
  permissions: string[];
}

/**
 * Доступ к агентам сверх прав модуля: другой модуль решает, к каким агентам
 * у пользователя есть доступ (например, агенты его узлов). Регистрация —
 * `asAgentAccessPolicy(Cls)`.
 */
export interface IAgentAccessPolicy {
  /** Доступ к агенту на действие. */
  canAccess(
    actor: IAgentActor,
    agentId: string,
    action: TAgentAction,
  ): Promise<boolean>;
  /** Все агенты, к которым есть доступ на действие. */
  agentIds(actor: IAgentActor, action: TAgentAction): Promise<string[]>;
}

export const AGENT_ACCESS_POLICY = Symbol("AgentAccessPolicy");

export const asAgentAccessPolicy = (
  policy: new (...args: any[]) => IAgentAccessPolicy,
): TokenProvider<IAgentAccessPolicy> => ({
  provide: AGENT_ACCESS_POLICY,
  useClass: policy,
});

/** Право модуля на действие. */
const ACTION_PERMISSIONS: Record<TAgentAction, string> = {
  view: AgentPermissions.VIEW,
  manage: AgentPermissions.MANAGE,
  config: AgentPermissions.CONFIG,
  fetch: AgentPermissions.FETCH,
  logs: AgentPermissions.LOGS,
};

/** Область доступа: все агенты или перечисленные. */
export type TAgentScope = "all" | ReadonlySet<string>;

/**
 * Доступ к агентам: право модуля (`agent:*`) даёт доступ ко всем агентам,
 * иначе — к тем, что разрешают политики `AGENT_ACCESS_POLICY`. Невидимый
 * агент — 404, видимый без права на действие — 403.
 */
@Injectable()
export class AgentAccessService {
  constructor(
    @inject(AccessService) private readonly _access: AccessService,
    @multiInject(AGENT_ACCESS_POLICY)
    @optional()
    private readonly _policies: IAgentAccessPolicy[] = [],
  ) {}

  /** Право модуля на действие (доступ ко всем агентам). */
  hasAll(actor: IAgentActor, action: TAgentAction): boolean {
    return AccessService.allows(actor, ACTION_PERMISSIONS[action]);
  }

  async can(
    actor: IAgentActor,
    agentId: string,
    action: TAgentAction,
  ): Promise<boolean> {
    if (this.hasAll(actor, action)) return true;

    for (const policy of this._policies) {
      if (await policy.canAccess(actor, agentId, action)) return true;
    }

    return false;
  }

  /** Доступ по id пользователя (права из БД) — для комнат сокета. */
  async canUser(
    userId: string,
    agentId: string,
    action: TAgentAction,
  ): Promise<boolean> {
    const grant = await this._access.grantOf(userId);

    return this.can({ userId, ...grant }, agentId, action);
  }

  /** Невидимый агент — 404, видимый без права на действие — 403. */
  async require(
    actor: IAgentActor,
    agentId: string,
    action: TAgentAction,
  ): Promise<void> {
    if (await this.can(actor, agentId, action)) return;
    if (action !== "view" && (await this.can(actor, agentId, "view"))) {
      throw AgentError.FORBIDDEN();
    }

    throw AgentError.NOT_FOUND();
  }

  /** Все агенты или доступные через политики; нет доступа ни к одному — 403. */
  async scope(actor: IAgentActor, action: TAgentAction): Promise<TAgentScope> {
    if (this.hasAll(actor, action)) return "all";

    const ids = new Set<string>();

    for (const policy of this._policies) {
      for (const id of await policy.agentIds(actor, action)) ids.add(id);
    }

    if (ids.size === 0) throw AgentError.FORBIDDEN();

    return ids;
  }

  /**
   * Действие без конкретного агента: только с правом модуля, иначе — агент
   * обязателен (403).
   */
  requireAll(actor: IAgentActor, action: TAgentAction): void {
    if (!this.hasAll(actor, action)) throw AgentError.AGENT_REQUIRED();
  }
}

/** Агент в области доступа. */
export const inScope = (
  scope: TAgentScope,
  agentId: string | undefined,
): boolean => scope === "all" || (!!agentId && scope.has(agentId));
