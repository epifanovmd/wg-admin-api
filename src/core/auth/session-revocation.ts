import type { Redis } from "ioredis";

import { config } from "../../config";
import { logger } from "../logger";
import { getRedis } from "../redis";

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_557_600_000,
};

/**
 * Срок в формате jsonwebtoken (`900`, `15m`, `1d`) → миллисекунды.
 * Как в jsonwebtoken, число без единицы — миллисекунды.
 */
export const parseTtlMs = (ttl: string | number): number => {
  if (typeof ttl === "number") return ttl * 1_000;

  const match = /^(\d+)(ms|s|m|h|d|w|y)?$/.exec(ttl.trim());

  if (!match) return 0;

  return Number(match[1]) * UNIT_MS[match[2] ?? "ms"];
};

/** Сколько живёт access-токен: столько же хранится отметка об отзыве. */
export const accessTokenTtlMs = (): number =>
  Math.max(parseTtlMs(config.auth.jwt.accessTtl), 1_000);

export const REVOKED_SESSION_PREFIX = "revoked:session:";
export const REVOKED_USER_PREFIX = "revoked:user:";
export const PRIVILEGES_CHANGED_PREFIX = "privileges:changed:";

/** Итог проверки токена: отозван, выдан до смены прав или действителен (`null`). */
export type TokenRevocation = "revoked" | "privileges-changed" | null;

/** Состояние отзыва для одного access-токена. */
export interface IRevocationState {
  /** Сессия завершена. */
  sessionRevoked: boolean;
  /** Все токены пользователя, выданные до этого момента (секунды), отозваны. */
  userRevokedAt: number | null;
  /** Права пользователя изменились в этот момент (мс): токены до него устарели. */
  privilegesChangedAt: number | null;
}

/** Хранилище отметок об отзыве: Redis (общий для реплик) или память. */
export interface IRevocationBackend {
  revokeSessions(ids: string[], ttlMs: number): Promise<void>;
  revokeUser(userId: string, atSec: number, ttlMs: number): Promise<void>;
  markPrivilegesChanged(
    userId: string,
    atMs: number,
    ttlMs: number,
  ): Promise<void>;
  /** Одна операция на проверку: сессия, пользователь и смена прав. */
  lookup(sessionId: string, userId: string): Promise<IRevocationState>;
}

/** Память процесса; просроченное забывается при обращении и уборке. */
export class MemoryRevocationBackend implements IRevocationBackend {
  private readonly _entries = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private _sweepAt = 0;

  async revokeSessions(ids: string[], ttlMs: number): Promise<void> {
    this._sweep();

    for (const id of ids) {
      this._entries.set(REVOKED_SESSION_PREFIX + id, {
        value: 1,
        expiresAt: Date.now() + ttlMs,
      });
    }
  }

  async revokeUser(userId: string, atSec: number, ttlMs: number) {
    this._sweep();
    this._entries.set(REVOKED_USER_PREFIX + userId, {
      value: atSec,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async markPrivilegesChanged(userId: string, atMs: number, ttlMs: number) {
    this._sweep();
    this._entries.set(PRIVILEGES_CHANGED_PREFIX + userId, {
      value: atMs,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async lookup(sessionId: string, userId: string): Promise<IRevocationState> {
    return {
      sessionRevoked: this._get(REVOKED_SESSION_PREFIX + sessionId) !== null,
      userRevokedAt: this._get(REVOKED_USER_PREFIX + userId),
      privilegesChangedAt: this._get(PRIVILEGES_CHANGED_PREFIX + userId),
    };
  }

  private _get(key: string): number | null {
    const entry = this._entries.get(key);

    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this._entries.delete(key);

      return null;
    }

    return entry.value;
  }

  private _sweep(): void {
    const now = Date.now();

    if (now < this._sweepAt) return;
    this._sweepAt = now + 60_000;

    for (const [key, entry] of this._entries) {
      if (entry.expiresAt <= now) this._entries.delete(key);
    }
  }
}

/**
 * Redis: `revoked:session:<id>`, `revoked:user:<id>` и
 * `privileges:changed:<id>` с TTL, проверка — один MGET.
 */
export class RedisRevocationBackend implements IRevocationBackend {
  constructor(private readonly _redis: Redis) {}

  async revokeSessions(ids: string[], ttlMs: number): Promise<void> {
    if (!ids.length) return;

    const multi = this._redis.multi();

    for (const id of ids)
      multi.set(REVOKED_SESSION_PREFIX + id, "1", "PX", ttlMs);
    await multi.exec();
  }

  async revokeUser(userId: string, atSec: number, ttlMs: number) {
    await this._redis.set(
      REVOKED_USER_PREFIX + userId,
      String(atSec),
      "PX",
      ttlMs,
    );
  }

  async markPrivilegesChanged(userId: string, atMs: number, ttlMs: number) {
    await this._redis.set(
      PRIVILEGES_CHANGED_PREFIX + userId,
      String(atMs),
      "PX",
      ttlMs,
    );
  }

  async lookup(sessionId: string, userId: string): Promise<IRevocationState> {
    const [session, user, privileges] = await this._redis.mget(
      REVOKED_SESSION_PREFIX + sessionId,
      REVOKED_USER_PREFIX + userId,
      PRIVILEGES_CHANGED_PREFIX + userId,
    );

    return {
      sessionRevoked: session !== null,
      userRevokedAt: user === null ? null : Number(user),
      privilegesChangedAt: privileges === null ? null : Number(privileges),
    };
  }
}

/**
 * Вердикт по состоянию. Смена прав сравнивается в миллисекундах (`issuedAtMs`
 * из токена): токен, выданный сразу после смены, уже действителен. Без него —
 * по секундам `iat`, с запасом в сторону «устарел».
 */
const verdictOf = (
  state: IRevocationState,
  issuedAtSec: number,
  issuedAtMs: number | undefined,
): TokenRevocation => {
  if (
    state.sessionRevoked ||
    (state.userRevokedAt !== null && issuedAtSec <= state.userRevokedAt)
  ) {
    return "revoked";
  }

  const issuedMs = issuedAtMs ?? issuedAtSec * 1000 + 999;

  if (
    state.privilegesChangedAt !== null &&
    issuedMs <= state.privilegesChangedAt
  ) {
    return "privileges-changed";
  }

  return null;
};

export interface SessionRevocationOptions {
  /** Общий бэкенд реплик; `undefined` — только память процесса. */
  shared?: IRevocationBackend;
  /** Срок локального кэша ответов общего бэкенда, мс. */
  cacheTtlMs?: number;
  /** Предел записей локального кэша (LRU). */
  cacheSize?: number;
  /** Срок отметки об отзыве, мс (по умолчанию — срок access-токена). */
  ttlMs?: () => number;
}

/**
 * Список отозванных сессий. Отзыв пишется и в память процесса (эта реплика
 * видит его сразу), и в общий бэкенд. Проверка: память, затем общий бэкенд
 * с кэшем на `cacheTtlMs` — одна команда Redis на запрос, другие реплики
 * видят отзыв не позже чем через срок кэша. Недоступный Redis не валит
 * аутентификацию (fail-open), ошибка — в лог.
 */
export class SessionRevocationList {
  private readonly _local = new MemoryRevocationBackend();
  private readonly _cache = new Map<
    string,
    { state: IRevocationState; expiresAt: number }
  >();
  private readonly _shared?: IRevocationBackend;
  private readonly _cacheTtlMs: number;
  private readonly _cacheSize: number;
  private readonly _ttlMs: () => number;

  constructor(options: SessionRevocationOptions = {}) {
    this._shared = options.shared;
    this._cacheTtlMs = options.cacheTtlMs ?? 1_000;
    this._cacheSize = options.cacheSize ?? 10_000;
    this._ttlMs = options.ttlMs ?? accessTokenTtlMs;
  }

  /** Отозвать access-токены сессий до истечения их срока. */
  async revokeSessions(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;

    const ttl = this._ttlMs();

    await this._local.revokeSessions(sessionIds, ttl);
    for (const id of sessionIds) this._cache.delete(id);
    await this._shared?.revokeSessions(sessionIds, ttl);
  }

  /** Отозвать все access-токены пользователя, выданные до этого момента. */
  async revokeUser(userId: string): Promise<void> {
    const ttl = this._ttlMs();
    const atSec = Math.floor(Date.now() / 1000);

    await this._local.revokeUser(userId, atSec, ttl);
    this._cache.clear();
    await this._shared?.revokeUser(userId, atSec, ttl);
  }

  /**
   * Права пользователя изменились: его access-токены, выданные до этого
   * момента, отклоняются как устаревшие — клиент обновляет их refresh-токеном
   * (сессия остаётся).
   */
  async markPrivilegesChanged(userId: string): Promise<void> {
    const ttl = this._ttlMs();
    const atMs = Date.now();

    await this._local.markPrivilegesChanged(userId, atMs, ttl);
    this._cache.clear();
    await this._shared?.markPrivilegesChanged(userId, atMs, ttl);
  }

  /**
   * Проверка access-токена сессии `sessionId`, выданного в `issuedAtSec`
   * (`issuedAtMs` — точнее, если есть в токене).
   */
  async check(
    sessionId: string,
    userId: string,
    issuedAtSec: number,
    issuedAtMs?: number,
  ): Promise<TokenRevocation> {
    const local = verdictOf(
      await this._local.lookup(sessionId, userId),
      issuedAtSec,
      issuedAtMs,
    );

    if (local === "revoked") return local;

    const shared = await this._lookupShared(sessionId, userId);
    const remote = shared ? verdictOf(shared, issuedAtSec, issuedAtMs) : null;

    return remote === "revoked" ? remote : (local ?? remote);
  }

  private async _lookupShared(
    sessionId: string,
    userId: string,
  ): Promise<IRevocationState | null> {
    if (!this._shared) return null;

    const cached = this._cache.get(sessionId);

    if (cached && cached.expiresAt > Date.now()) return cached.state;

    try {
      const state = await this._shared.lookup(sessionId, userId);

      this._remember(sessionId, state);

      return state;
    } catch (err) {
      logger.warn({ err }, "[Auth] Revocation lookup failed");

      return null;
    }
  }

  private _remember(sessionId: string, state: IRevocationState): void {
    this._cache.delete(sessionId);
    this._cache.set(sessionId, {
      state,
      expiresAt: Date.now() + this._cacheTtlMs,
    });

    if (this._cache.size > this._cacheSize) {
      const oldest = this._cache.keys().next().value;

      if (oldest !== undefined) this._cache.delete(oldest);
    }
  }
}

let revocations: SessionRevocationList | undefined;

/** Список приложения: Redis, если настроен, иначе память процесса. */
export const getSessionRevocations = (): SessionRevocationList => {
  if (!revocations) {
    const redis = getRedis();

    revocations = new SessionRevocationList({
      shared: redis ? new RedisRevocationBackend(redis) : undefined,
    });
  }

  return revocations;
};

/** Подменить список (тесты); `undefined` — пересоздать при следующем обращении. */
export const setSessionRevocations = (
  list: SessionRevocationList | undefined,
): void => {
  revocations = list;
};
