import type { Context } from "koa";

import { config, isProduction } from "../../config";
import type { ITokensDto } from "../../core";

/** Имя httpOnly-cookie с refresh-токеном. */
export const REFRESH_COOKIE = "refresh_token";

/** Cookie уходит только на эндпоинты auth (refresh, sign-out). */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

const MS_IN_DAY = 86_400_000;

/** Выставлять ли cookie: флаг `AUTH_REFRESH_COOKIE`. */
export const isRefreshCookieEnabled = (): boolean =>
  config.auth.jwt.refreshCookie;

export interface RefreshCookieOptions {
  /** Флаг Secure; по умолчанию — в production. */
  secure?: boolean;
}

/**
 * Secure-cookie всегда, если так решено, даже когда запрос дошёл по HTTP:
 * TLS обычно завершается на прокси, и без `TRUST_PROXY` Koa считает запрос
 * небезопасным и бросает исключение. Браузер видит HTTPS и cookie примет.
 */
const allowSecure = (ctx: Context, secure: boolean): void => {
  if (secure) ctx.cookies.secure = true;
};

/**
 * Положить refresh-токен в httpOnly-cookie (если включено): Secure в
 * production, SameSite=Strict, Path — только auth.
 */
export const setRefreshCookie = (
  ctx: Context,
  tokens: ITokensDto | undefined,
  { secure = isProduction }: RefreshCookieOptions = {},
): void => {
  if (!isRefreshCookieEnabled() || !tokens?.refreshToken) return;

  allowSecure(ctx, secure);
  ctx.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: config.auth.jwt.refreshTtlDays * MS_IN_DAY,
    overwrite: true,
  });
};

/** Стереть cookie (выход). */
export const clearRefreshCookie = (
  ctx: Context,
  { secure = isProduction }: RefreshCookieOptions = {},
): void => {
  if (!isRefreshCookieEnabled()) return;

  allowSecure(ctx, secure);
  ctx.cookies.set(REFRESH_COOKIE, null, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    overwrite: true,
  });
};

/** Refresh-токен из cookie; без флага cookie не читается. */
export const readRefreshCookie = (ctx: Context): string | undefined =>
  isRefreshCookieEnabled()
    ? ctx.cookies.get(REFRESH_COOKIE) || undefined
    : undefined;
