import { randomUUID } from "crypto";
import { TokenExpiredError } from "jsonwebtoken";

import { config } from "../../config";
import { AuthContext, JWTDecoded } from "../../types/koa";
import { Injectable } from "../decorators";
import { AuthTokenError } from "./auth-token.errors";
import { hasPermission, isSuperUserGrant } from "./has-permission";
import {
  createToken,
  createTokenAsync,
  TokenPayload,
  TokenScope,
  verifyToken,
} from "./jwt";
import { getSessionRevocations } from "./session-revocation";

/**
 * Кому выдаются токены — без привязки к сущностям модулей: роли и
 * эффективные права уже собраны вызывающим (модуль auth).
 */
export interface TokenSubject {
  id: string;
  roles: string[];
  /** Эффективные права: права ролей ∪ прямые права. */
  permissions: string[];
  emailVerified: boolean;
}

/** Проверенный access-токен и момент его истечения. */
export interface IAccessContext {
  context: AuthContext;
  expiresAt: Date;
}

export interface ITokensDto {
  accessToken: string;
  refreshToken: string;
  /** Сколько секунд живёт access-токен (как `expires_in` в OAuth 2.0). */
  expiresIn: number;
  /** Сессия, к которой привязаны токены. */
  sessionId: string;
}

/** Выданная пара плюс срок refresh-токена — он же срок сессии. */
export interface IIssuedTokens extends ITokensDto {
  refreshExpiresAt: Date;
}

/** Проверенный refresh-токен: чья сессия и когда истекает. */
export interface IRefreshContext {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

/** Проверенный 2FA-токен: кто проходит второй фактор и одноразовый `jti`. */
export interface ITwoFactorContext {
  userId: string;
  jti: string;
  expiresAt: Date;
}

export type SecurityScopes = string[];

/** Сколько живёт refresh-токен, а с ним и сессия. */
const refreshTtl = () => `${config.auth.jwt.refreshTtlDays}d` as const;

/** Окно между вводом пароля и вторым фактором. */
export const TWO_FACTOR_TOKEN_TTL = "5m";

/** Claims без проверки подписи — для сроков уже проверенных или своих токенов. */
const claimsOf = (token: string): { exp: number; iat: number } => {
  const [, body] = token.split(".");

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
};

/**
 * Выдача и проверка JWT. Проверка без БД — всё нужное лежит в токене,
 * отзыв сессий — в списке отозванных (Redis или память, см.
 * `session-revocation.ts`); сессию при обновлении сверяет модуль auth.
 */
@Injectable()
export class TokenService {
  /**
   * Выдаёт access + refresh токены. Роли и эффективные права берутся из
   * `subject` как есть — при аутентификации запроса БД не нужна.
   * Назначение (`scope`) зашито в токен: refresh к API не подходит.
   */
  async issue(
    subject: TokenSubject,
    sessionId: string,
  ): Promise<IIssuedTokens> {
    const payload: Omit<TokenPayload, "scope"> = {
      userId: subject.id,
      sessionId,
      roles: [...subject.roles],
      permissions: [...new Set(subject.permissions)],
      emailVerified: subject.emailVerified,
    };

    const [accessToken, refreshToken] = await createTokenAsync([
      {
        payload: { ...payload, scope: "access" },
        opts: { expiresIn: config.auth.jwt.accessTtl },
      },
      {
        payload: { ...payload, scope: "refresh" },
        // jti: два refresh-токена одной сессии никогда не совпадают — иначе
        // ротация в пределах секунды оставила бы прежний токен рабочим.
        opts: { expiresIn: refreshTtl(), jwtid: randomUUID() },
      },
    ]);

    const access = claimsOf(accessToken);

    return {
      accessToken,
      refreshToken,
      expiresIn: access.exp - access.iat,
      sessionId,
      refreshExpiresAt: new Date(claimsOf(refreshToken).exp * 1000),
    };
  }

  /** Промежуточный 2FA-токен: пароль принят, ждём второй фактор. */
  issueTwoFactor(userId: string): Promise<string> {
    return createToken(
      { scope: "2fa", userId, jti: randomUUID() },
      { expiresIn: TWO_FACTOR_TOKEN_TTL },
    );
  }

  /**
   * Верифицирует access-токен: подпись, назначение, отзыв сессии и области
   * действия. Токены другого назначения и завершённых сессий отклоняются.
   */
  async verify(token?: string, scopes?: SecurityScopes): Promise<AuthContext> {
    return (await this.verifyAccess(token, scopes)).context;
  }

  /** То же, что `verify`, плюс срок токена — для долгих соединений (сокет). */
  async verifyAccess(
    token?: string,
    scopes?: SecurityScopes,
  ): Promise<IAccessContext> {
    const decoded = await this.decode(token, "access");
    const context = TokenService.toContext(decoded);

    if (
      await getSessionRevocations().isRevoked(
        context.sessionId,
        context.userId,
        decoded.iat,
      )
    ) {
      throw AuthTokenError.SESSION_REVOKED();
    }

    if (scopes && scopes.length > 0) {
      this.checkScopes(decoded, scopes);
    }

    return { context, expiresAt: new Date(decoded.exp * 1000) };
  }

  /** Отозвать access-токены сессий: следующий запрос с ними получит 401. */
  revokeSessions(sessionIds: string[]): Promise<void> {
    return getSessionRevocations().revokeSessions(sessionIds);
  }

  /** Отозвать все выданные пользователю access-токены (удаление аккаунта). */
  revokeUser(userId: string): Promise<void> {
    return getSessionRevocations().revokeUser(userId);
  }

  /** Refresh-токен: подпись и назначение; сессию сверяет AuthService. */
  async verifyRefresh(token?: string): Promise<IRefreshContext> {
    const decoded = await this.decode(token, "refresh");
    const { userId, sessionId } = TokenService.toContext(decoded);

    return { userId, sessionId, expiresAt: new Date(decoded.exp * 1000) };
  }

  /** 2FA-токен: подпись и назначение; одноразовость `jti` проверяет AuthService. */
  async verifyTwoFactor(token?: string): Promise<ITwoFactorContext> {
    const decoded = await this.decode(token, "2fa");

    if (!decoded.jti) {
      throw AuthTokenError.TOKEN_WRONG_SCOPE();
    }

    return {
      userId: decoded.userId,
      jti: decoded.jti,
      expiresAt: new Date(decoded.exp * 1000),
    };
  }

  private async decode(
    token: string | undefined,
    scope: TokenScope,
  ): Promise<JWTDecoded> {
    if (!token) {
      throw AuthTokenError.TOKEN_MISSING();
    }

    let decoded: JWTDecoded;

    try {
      decoded = await verifyToken(token);
    } catch (error) {
      throw error instanceof TokenExpiredError
        ? AuthTokenError.TOKEN_EXPIRED()
        : AuthTokenError.TOKEN_INVALID();
    }

    if (decoded.scope !== scope || typeof decoded.userId !== "string") {
      throw AuthTokenError.TOKEN_WRONG_SCOPE();
    }

    return decoded;
  }

  /** Access/refresh без сессии — не наш токен, даже если подпись верна. */
  private static toContext(decoded: JWTDecoded): AuthContext {
    if (typeof decoded.sessionId !== "string" || !decoded.sessionId) {
      throw AuthTokenError.TOKEN_NO_SESSION();
    }

    return {
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      roles: decoded.roles ?? [],
      permissions: decoded.permissions ?? [],
      emailVerified: decoded.emailVerified ?? false,
    };
  }

  /**
   * Проверяет, что токен удовлетворяет ВСЕМ требуемым областям (семантика AND).
   * Обход суперпользователя: `SUPERUSER_ROLE` или право `ALL_PERMISSIONS`.
   */
  private checkScopes(decoded: JWTDecoded, scopes: SecurityScopes): void {
    const roles = decoded.roles ?? [];
    const permissions = decoded.permissions ?? [];

    if (isSuperUserGrant(roles, permissions)) return;

    for (const scope of scopes) {
      if (scope.startsWith("role:")) {
        if (!roles.includes(scope.slice(5))) {
          throw AuthTokenError.INSUFFICIENT_ROLE();
        }
      } else if (scope.startsWith("permission:")) {
        if (!hasPermission(permissions, scope.slice(11))) {
          throw AuthTokenError.INSUFFICIENT_PERMISSIONS();
        }
      }
    }
  }
}
