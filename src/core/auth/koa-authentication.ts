import { Request } from "koa";

import { iocContainer } from "../../app.container";
import { AuthContext } from "../../types/koa";
import { InternalServerErrorException } from "../http";
import { ISecurityScheme, SECURITY_SCHEME } from "./security-scheme";

let schemes: Map<string, ISecurityScheme> | undefined;

/** Схемы из контейнера — собираются один раз, после загрузки модулей. */
const getSchemes = (): Map<string, ISecurityScheme> => {
  schemes ??= new Map(
    iocContainer
      .getAll<ISecurityScheme>(SECURITY_SCHEME)
      .map(scheme => [scheme.name, scheme]),
  );

  return schemes;
};

/** Сбросить кэш схем (тесты, пересборка контейнера). */
export const resetSecuritySchemes = (): void => {
  schemes = undefined;
};

/**
 * Точка входа tsoa для `@Security(name, scopes)`: делегирует схеме из
 * реестра `SECURITY_SCHEME`. Ядро не знает о конкретных схемах модулей.
 */
export const koaAuthentication = async (
  request: Request,
  securityName: string,
  scopes?: string[],
): Promise<AuthContext> => {
  const scheme = getSchemes().get(securityName);

  if (!scheme) {
    throw new InternalServerErrorException(
      `Схема аутентификации «${securityName}» не зарегистрирована`,
    );
  }

  const context = await scheme.authenticate(request, scopes ?? []);

  // Логгер запросов и гарды читают вызывающего из state
  request.ctx.state.user = context;

  return context;
};
