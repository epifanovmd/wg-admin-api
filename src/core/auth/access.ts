import { inject } from "inversify";

import type { TokenProvider } from "../decorators";
import { Injectable } from "../decorators";
import { type AccessScope, resolveScope } from "./access-scope";
import { hasPermission, isSuperUserGrant } from "./has-permission";

/** Роли и эффективные права пользователя (права ролей ∪ прямые). */
export interface IUserGrant {
  roles: string[];
  permissions: string[];
}

/**
 * Источник актуальных прав пользователя по userId — для мест без
 * HTTP-контекста (политики сокет-комнат, слушатели). Реализует модуль
 * пользователей; `null` — пользователя нет.
 */
export interface IGrantResolver {
  grantOf(userId: string): Promise<IUserGrant | null>;
}

export const GRANT_RESOLVER = Symbol("GrantResolver");

export const asGrantResolver = (
  resolver: new (...args: any[]) => IGrantResolver,
): TokenProvider<IGrantResolver> => ({
  provide: GRANT_RESOLVER,
  useClass: resolver,
});

const EMPTY_GRANT: IUserGrant = { roles: [], permissions: [] };

/**
 * Проверка прав по userId из БД, без кэша: результат всегда отражает
 * последнюю смену прав (в отличие от токена, где права — на момент выдачи).
 */
@Injectable()
export class AccessService {
  constructor(
    @inject(GRANT_RESOLVER) private readonly _resolver: IGrantResolver,
  ) {}

  async grantOf(userId: string): Promise<IUserGrant> {
    return (await this._resolver.grantOf(userId)) ?? EMPTY_GRANT;
  }

  async can(userId: string, permission: string): Promise<boolean> {
    return AccessService.allows(await this.grantOf(userId), permission);
  }

  /** Область права пользователя: все сущности, только свои или нет права. */
  async scope(userId: string, permission: string): Promise<AccessScope | null> {
    const grant = await this.grantOf(userId);

    return resolveScope(grant.roles, grant.permissions, permission);
  }

  async isSuperUser(userId: string): Promise<boolean> {
    const grant = await this.grantOf(userId);

    return isSuperUserGrant(grant.roles, grant.permissions);
  }

  /** Право в наборе прав: суперпользователь или совпадение с учётом wildcard. */
  static allows(grant: IUserGrant, permission: string): boolean {
    return (
      isSuperUserGrant(grant.roles, grant.permissions) ||
      hasPermission(grant.permissions, permission)
    );
  }
}
