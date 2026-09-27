import type { Request } from "koa";

import type { AuthContext } from "../../types/koa";
import type { TokenProvider } from "../decorators";

/**
 * Токен multi-inject схем аутентификации для `@Security("<name>")`.
 * Ядро регистрирует `jwt`; модули добавляют свои (`bot`, `api-key`).
 */
export const SECURITY_SCHEME = Symbol("SecurityScheme");

export interface ISecurityScheme {
  /** Имя схемы в `@Security(name)` и в `tsoa.json → securityDefinitions`. */
  readonly name: string;
  /** Контекст вызывающего или исключение (401/403). */
  authenticate(request: Request, scopes: string[]): Promise<AuthContext>;
}

export const asSecurityScheme = (
  scheme: new (...args: any[]) => ISecurityScheme,
): TokenProvider<ISecurityScheme> => ({
  provide: SECURITY_SCHEME,
  useClass: scheme,
});
