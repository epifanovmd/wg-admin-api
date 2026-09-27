import {
  Injectable,
  validatePasswordPolicy,
  ValidationException,
} from "../../core";
import type { IPasswordPolicy, IPasswordPolicyContext } from "../user";

/**
 * Политика пароля для модуля user (смена пароля): та же
 * `validatePasswordPolicy`, что на регистрации и сбросе.
 */
@Injectable()
export class AuthPasswordPolicy implements IPasswordPolicy {
  validate(password: string, context: IPasswordPolicyContext): void {
    const problem = validatePasswordPolicy(password, {
      email: context.email,
      username: context.username,
    });

    if (problem) throw new ValidationException({ password: problem });
  }
}
