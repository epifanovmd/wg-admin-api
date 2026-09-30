import type { AuthContext } from "../../types/koa";
import {
  hasPermission,
  isSuperUserGrant,
  ownPermission,
} from "./has-permission";

/** Область действия права: над всеми сущностями или только над своими. */
export type AccessScope = "all" | "own";

/**
 * Область права в наборе: `all` — суперпользователь, само право или wildcard;
 * `own` — только `<право>:own`; `null` — права нет.
 */
export const resolveScope = (
  roles: string[],
  permissions: string[],
  permission: string,
): AccessScope | null => {
  if (
    isSuperUserGrant(roles, permissions) ||
    hasPermission(permissions, permission)
  ) {
    return "all";
  }

  return hasPermission(permissions, ownPermission(permission)) ? "own" : null;
};

/** Поля сущности, по которым она «своя»: назначенный владелец и создатель. */
export interface IOwnershipKeys<T> {
  owner: keyof T & string;
  creator: keyof T & string;
}

/**
 * Доступ к сущностям с областью «все / свои». Своя — та, где пользователь
 * владелец или создатель.
 *
 * @example
 * const access = new OwnedAccess<WgPeer>({ owner: "userId", creator: "createdById" });
 * access.can(actor, WgPeerPermissions.PEER_UPDATE, peer);
 */
export class OwnedAccess<T extends object> {
  constructor(readonly keys: IOwnershipKeys<T>) {}

  scope(actor: AuthContext, permission: string): AccessScope | null {
    return resolveScope(actor.roles, actor.permissions, permission);
  }

  isOwn(userId: string, entity: T): boolean {
    return (
      entity[this.keys.owner] === userId || entity[this.keys.creator] === userId
    );
  }

  can(actor: AuthContext, permission: string, entity: T): boolean {
    const scope = this.scope(actor, permission);

    return (
      scope === "all" || (scope === "own" && this.isOwn(actor.userId, entity))
    );
  }

  /** Условие «своих» для QueryBuilder; значение — параметр `:ownedBy`. */
  ownedCondition(alias: string): string {
    return `(${alias}.${this.keys.owner} = :ownedBy OR ${alias}.${this.keys.creator} = :ownedBy)`;
  }

  /** Условие «своих» для `find`: OR владелец / создатель. */
  ownedWhere(userId: string): Array<Record<string, string>> {
    return [{ [this.keys.owner]: userId }, { [this.keys.creator]: userId }];
  }

  /**
   * Ограничение выборки: `{}` — все, `{ ownedBy }` — только свои,
   * `null` — права нет.
   */
  filter(actor: AuthContext, permission: string): { ownedBy?: string } | null {
    const scope = this.scope(actor, permission);

    if (scope === "all") return {};

    return scope === "own" ? { ownedBy: actor.userId } : null;
  }

  /**
   * Ограничение списка с фильтром «Мои»: при `mine` — только свои при любой
   * области права, иначе — как `filter`. `null` — права нет.
   */
  listFilter(
    actor: AuthContext,
    permission: string,
    mine?: boolean,
  ): { ownedBy?: string } | null {
    const filter = this.filter(actor, permission);

    if (!filter) return null;

    return mine ? { ownedBy: actor.userId } : filter;
  }
}
