import Koa from "koa";

import type { TokenScope } from "../core/auth/jwt";

export type AuthContext = {
  /**
   * Кто вызывает: пользователь (jwt), бот, сервис по API-ключу (агент
   * ноды, интеграция). По умолчанию — пользователь.
   */
  kind?: "user" | "bot" | "service";
  userId: string;
  sessionId: string;
  /** Все роли, назначенные этому пользователю. */
  roles: string[];
  /**
   * Эффективные разрешения — предварительно объединённый набор всех разрешений ролей
   * плюс directPermissions. Вычисляются при выдаче токена, без запросов к БД.
   */
  permissions: string[];
  emailVerified: boolean;
};

/**
 * Что лежит в проверенном JWT. Набор полей зависит от `scope`: у access/refresh
 * есть сессия, роли и права; у 2FA-токена — только пользователь и `jti`.
 */
export type JWTDecoded = {
  scope?: TokenScope;
  userId: string;
  sessionId?: string;
  roles?: string[];
  permissions?: string[];
  emailVerified?: boolean;
  jti?: string;
  /** Момент выдачи, мс (access/refresh). */
  pat?: number;
  iat: number;
  exp: number;
};

interface RequestClient {
  ctx: Koa.Context & {
    request: {
      user: AuthContext | undefined;
    };
  };
}

export type KoaRequest = Koa.Request & RequestClient;
