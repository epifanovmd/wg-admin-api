import type { TokenSubject } from "../../core";
import type { User } from "../user/user.entity";
import { grantOfUser } from "../user/user-grant.resolver";

/**
 * Субъект токена из пользователя: роли и эффективные права
 * (права ролей ∪ прямые права) — один раз при выдаче токенов.
 */
export const toTokenSubject = (user: User): TokenSubject => ({
  id: user.id,
  ...grantOfUser(user),
  emailVerified: user.emailVerified,
});
