import type { TokenSubject } from "../../core";
import type { User } from "../user/user.entity";

/**
 * Субъект токена из пользователя: роли и эффективные права
 * (права ролей ∪ прямые права) — один раз при выдаче токенов.
 */
export const toTokenSubject = (user: User): TokenSubject => {
  const rolePermissions =
    user.roles?.flatMap(r => r.permissions?.map(p => p.name) ?? []) ?? [];
  const directPermissions = user.directPermissions?.map(p => p.name) ?? [];

  return {
    id: user.id,
    roles: user.roles?.map(r => r.name) ?? [],
    permissions: [...new Set([...rolePermissions, ...directPermissions])],
    emailVerified: user.emailVerified,
  };
};
