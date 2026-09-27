import type { Redis } from "ioredis";

import { getRedis, Injectable } from "../../core";

/**
 * Счётчики неудач, блокировки и одноразовые отметки с TTL. Общие для реплик
 * через Redis, без Redis — в памяти процесса. Пространство имён ключей задаёт
 * владелец (`new AttemptsStore(prefix)`).
 */
export interface IAttemptsStore {
  /** Текущее число неудач по ключу (0 — нет или окно истекло). */
  getFailures(key: string): Promise<number>;
  /** Зафиксировать неудачу; окно отсчитывается от первой. Возвращает счётчик. */
  addFailure(key: string, windowMs: number): Promise<number>;
  resetFailures(key: string): Promise<void>;
  /** Атомарно отметить ключ на `ttlMs`. `false` — уже был отмечен. */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  /** Сколько миллисекунд ещё живёт ключ; 0 — ключа нет. */
  ttlMs(key: string): Promise<number>;
}

type Entry = { value: number; expiresAt: number };

/** Память одной реплики; просроченные записи забываются при обращении. */
export class MemoryAttemptsStore implements IAttemptsStore {
  private readonly _entries = new Map<string, Entry>();
  private _sweepAt = 0;

  constructor(private readonly _sweepIntervalMs = 60_000) {}

  async getFailures(key: string): Promise<number> {
    return this._get(key)?.value ?? 0;
  }

  async addFailure(key: string, windowMs: number): Promise<number> {
    this._sweep();

    const entry = this._get(key);

    if (entry) {
      entry.value += 1;

      return entry.value;
    }

    this._entries.set(key, { value: 1, expiresAt: Date.now() + windowMs });

    return 1;
  }

  async resetFailures(key: string): Promise<void> {
    this._entries.delete(key);
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    this._sweep();

    if (this._get(key)) return false;

    this._entries.set(key, { value: 1, expiresAt: Date.now() + ttlMs });

    return true;
  }

  async ttlMs(key: string): Promise<number> {
    const entry = this._get(key);

    return entry ? entry.expiresAt - Date.now() : 0;
  }

  private _sweep(): void {
    const now = Date.now();

    if (now < this._sweepAt) return;

    this._sweepAt = now + this._sweepIntervalMs;

    for (const [key, entry] of this._entries) {
      if (entry.expiresAt <= now) this._entries.delete(key);
    }
  }

  private _get(key: string): Entry | undefined {
    const entry = this._entries.get(key);

    if (entry && entry.expiresAt <= Date.now()) {
      this._entries.delete(key);

      return undefined;
    }

    return entry;
  }
}

/** Общие для всех реплик счётчики и отметки. */
export class RedisAttemptsStore implements IAttemptsStore {
  constructor(private readonly _redis: Redis) {}

  async getFailures(key: string): Promise<number> {
    return Number(await this._redis.get(key)) || 0;
  }

  async addFailure(key: string, windowMs: number): Promise<number> {
    const [[, count], [, ttl]] = (await this._redis
      .multi()
      .incr(key)
      .pttl(key)
      .exec()) as [[null, number], [null, number]];

    if (ttl < 0) await this._redis.pexpire(key, windowMs);

    return count;
  }

  async resetFailures(key: string): Promise<void> {
    await this._redis.del(key);
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    return (await this._redis.set(key, "1", "PX", ttlMs, "NX")) === "OK";
  }

  async ttlMs(key: string): Promise<number> {
    return Math.max(await this._redis.pttl(key), 0);
  }
}

/** Хранилище с префиксом ключей: Redis, если настроен, иначе память процесса. */
export class AttemptsStore implements IAttemptsStore {
  constructor(
    private readonly _prefix: string,
    private _backend?: IAttemptsStore,
  ) {}

  getFailures(key: string) {
    return this._store().getFailures(this._prefix + key);
  }

  addFailure(key: string, windowMs: number) {
    return this._store().addFailure(this._prefix + key, windowMs);
  }

  resetFailures(key: string) {
    return this._store().resetFailures(this._prefix + key);
  }

  claimOnce(key: string, ttlMs: number) {
    return this._store().claimOnce(this._prefix + key, ttlMs);
  }

  ttlMs(key: string) {
    return this._store().ttlMs(this._prefix + key);
  }

  private _store(): IAttemptsStore {
    if (!this._backend) {
      const redis = getRedis();

      this._backend = redis
        ? new RedisAttemptsStore(redis)
        : new MemoryAttemptsStore();
    }

    return this._backend;
  }
}

/** Хранилище модуля auth (ключи `auth:*`): 2FA, блокировка входа, jti. */
@Injectable()
export class AuthAttemptsStore implements IAttemptsStore {
  private readonly _store = new AttemptsStore("auth:");

  getFailures(key: string) {
    return this._store.getFailures(key);
  }

  addFailure(key: string, windowMs: number) {
    return this._store.addFailure(key, windowMs);
  }

  resetFailures(key: string) {
    return this._store.resetFailures(key);
  }

  claimOnce(key: string, ttlMs: number) {
    return this._store.claimOnce(key, ttlMs);
  }

  ttlMs(key: string) {
    return this._store.ttlMs(key);
  }
}
