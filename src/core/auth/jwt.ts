import jwt, { SignOptions, VerifyErrors, VerifyOptions } from "jsonwebtoken";

import { config } from "../../config";
import { JWTDecoded } from "../../types/koa";

export type { SecurityScopes } from "./token.service";

/**
 * Назначение токена. Каждый JWT несёт его явно, и проверяющий требует точного
 * совпадения: refresh или 2FA-токен не пройдут как access к API.
 * Токен сброса пароля — не JWT, а случайная строка (см. reset-password-tokens).
 */
export type TokenScope = "access" | "refresh" | "2fa";

/** Полезная нагрузка access/refresh-токена, привязанного к сессии. */
export type TokenPayload = {
  scope: "access" | "refresh";
  userId: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
  emailVerified: boolean;
};

/** Промежуточный токен между вводом пароля и вводом второго фактора. */
export type TwoFactorTokenPayload = {
  scope: "2fa";
  userId: string;
  /** Одноразовость: использованный jti запоминается до истечения токена. */
  jti: string;
};

const ALGORITHM = "HS256";

/** Подпись и проверка ограничены одним алгоритмом и нашим issuer/audience. */
const signOptions = (opts?: SignOptions): SignOptions => ({
  algorithm: ALGORITHM,
  issuer: config.app.name,
  audience: config.app.name,
  ...opts,
});

const verifyOptions = (): VerifyOptions => ({
  algorithms: [ALGORITHM],
  issuer: config.app.name,
  audience: config.app.name,
});

export const createToken = (
  payload: TokenPayload | TwoFactorTokenPayload,
  opts?: SignOptions,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    try {
      resolve(jwt.sign(payload, config.auth.jwt.secretKey, signOptions(opts)));
    } catch (error) {
      reject(error);
    }
  });

export const createTokenAsync = (
  data: { payload: TokenPayload; opts?: SignOptions }[],
) => Promise.all(data.map(({ payload, opts }) => createToken(payload, opts)));

/** Проверяет подпись, срок, issuer и audience; назначение проверяет вызывающий. */
export const verifyToken = (token: string): Promise<JWTDecoded> =>
  new Promise<JWTDecoded>((resolve, reject) => {
    jwt.verify(
      token,
      config.auth.jwt.secretKey,
      verifyOptions(),
      (err: VerifyErrors | null, decoded) => {
        if (err) reject(err);
        else resolve(decoded as JWTDecoded);
      },
    );
  });
