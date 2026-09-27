import type { TokenProvider } from "../../core";

/** Токен multi-inject политик пароля. */
export const PASSWORD_POLICY = Symbol("PasswordPolicy");

/** Кому принадлежит пароль: политика может запретить пароль, совпадающий с email/username. */
export interface IPasswordPolicyContext {
  userId?: string;
  email?: string | null;
  username?: string | null;
}

/**
 * Политика пароля. Модуль user не зависит от реализации: её регистрирует
 * модуль auth (`asPasswordPolicy(Cls)`), внутри — `validatePasswordPolicy`.
 * Нарушение — исключение (ожидается `ValidationException`).
 * Без зарегистрированной политики действуют только ограничения Zod-схем.
 */
export interface IPasswordPolicy {
  validate(
    password: string,
    context: IPasswordPolicyContext,
  ): void | Promise<void>;
}

export const asPasswordPolicy = (
  policy: new (...args: any[]) => IPasswordPolicy,
): TokenProvider<IPasswordPolicy> => ({
  provide: PASSWORD_POLICY,
  useClass: policy,
});
