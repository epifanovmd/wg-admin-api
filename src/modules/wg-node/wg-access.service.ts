import { inject } from "inversify";

import { hasPermission, Injectable, isSuperUserGrant } from "../../core";
import { UserRepository } from "../user";

interface ICachedGrant {
  roles: string[];
  permissions: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000;
const CACHE_MAX = 1000;

/**
 * Проверка прав по userId для мест без HTTP-контекста (политики сокет-комнат,
 * слушатели): эффективные права пользователя из БД с коротким кэшем.
 */
@Injectable()
export class WgAccessService {
  private readonly _cache = new Map<string, ICachedGrant>();

  constructor(
    @inject(UserRepository) private readonly _users: UserRepository,
  ) {}

  async can(userId: string, permission: string): Promise<boolean> {
    const grant = await this._grantOf(userId);

    return (
      isSuperUserGrant(grant.roles, grant.permissions) ||
      hasPermission(grant.permissions, permission)
    );
  }

  private async _grantOf(userId: string): Promise<ICachedGrant> {
    const cached = this._cache.get(userId);

    if (cached && cached.expiresAt > Date.now()) return cached;

    const user = await this._users.findOne({
      where: { id: userId },
      relations: { roles: { permissions: true }, directPermissions: true },
    });

    const roles = user?.roles?.map(role => role.name) ?? [];
    const permissions = [
      ...new Set([
        ...(user?.roles?.flatMap(
          role => role.permissions?.map(permission => permission.name) ?? [],
        ) ?? []),
        ...(user?.directPermissions?.map(permission => permission.name) ?? []),
      ]),
    ];
    const grant: ICachedGrant = {
      roles,
      permissions,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    if (this._cache.size >= CACHE_MAX) this._cache.clear();
    this._cache.set(userId, grant);

    return grant;
  }
}
