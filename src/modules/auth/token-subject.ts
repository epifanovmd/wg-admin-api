import type { TokenSubject } from "../../core";
import { grantOfUser } from "../user";
import type { User } from "../user/user.entity";

/**
 * Субъект токена из пользователя: роли и эффективные права
 * (права ролей ∪ прямые права) — один раз при выдаче токенов.
 */
export const toTokenSubject = (user: User): TokenSubject => ({
  id: user.id,
  ...grantOfUser(user),
  emailVerified: user.emailVerified,
});
