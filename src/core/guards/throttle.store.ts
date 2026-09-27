import type { Redis } from "ioredis";

import { getRedis } from "../redis/redis";

export interface ThrottleHit {
  count: number;
  resetAt: number;
}

/** Счётчик обращений в скользящем окне; ключ — маршрут + клиент. */
export interface IThrottleStore {
  hit(key: string, windowMs: number): Promise<ThrottleHit>;
}

type Record = { count: number; resetAt: number };

/** Память одной реплики; просроченные записи убираются при обращении. */
export class MemoryThrottleStore implements IThrottleStore {
  private readonly _records = new Map<string, Record>();
  private _sweepAt = 0;

  constructor(private readonly _sweepIntervalMs = 60_000) {}

  async hit(key: string, windowMs: number): Promise<ThrottleHit> {
    const now = Date.now();

    this._sweep(now);

    const record = this._records.get(key);

    if (!record || now > record.resetAt) {
      const fresh = { count: 1, resetAt: now + windowMs };

      this._records.set(key, fresh);

      return fresh;
    }

    record.count += 1;

    return record;
  }

  private _sweep(now: number): void {
    if (now < this._sweepAt) return;

    this._sweepAt = now + this._sweepIntervalMs;

    for (const [key, record] of this._records) {
      if (now > record.resetAt) this._records.delete(key);
    }
  }
}

/** Общий счётчик для всех реплик: INCR + PEXPIRE атомарно. */
export class RedisThrottleStore implements IThrottleStore {
  constructor(private readonly _redis: Redis) {}

  async hit(key: string, windowMs: number): Promise<ThrottleHit> {
    const [[, count], [, ttl]] = (await this._redis
      .multi()
      .incr(key)
      .pttl(key)
      .exec()) as [[null, number], [null, number]];

    // Первый hit в окне: срок ещё не выставлен.
    if (ttl < 0) {
      await this._redis.pexpire(key, windowMs);

      return { count, resetAt: Date.now() + windowMs };
    }

    return { count, resetAt: Date.now() + ttl };
  }
}

let defaultStore: IThrottleStore | undefined;

/** Redis, если настроен, иначе память процесса. */
export const getThrottleStore = (): IThrottleStore => {
  if (!defaultStore) {
    const redis = getRedis();

    defaultStore = redis
      ? new RedisThrottleStore(redis)
      : new MemoryThrottleStore();
  }

  return defaultStore;
};
