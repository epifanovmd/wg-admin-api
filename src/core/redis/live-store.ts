import type { ChainableCommander } from "ioredis";

import { getRedis } from "./redis";

/** Память процесса разрастается без Redis — чистим просроченное с этого размера. */
const MEM_PRUNE_AT = 50_000;
/** Кольцевые ряды в памяти процесса хранятся JSON-массивом под своим ключом. */
const LIST_PREFIX = "list:";

/** Выполнить конвейер: ошибка любой команды — ошибка всего вызова. */
const execPipeline = async (
  pipeline: ChainableCommander,
): Promise<unknown[]> => {
  const results = (await pipeline.exec()) ?? [];

  return results.map(([err, value]) => {
    if (err) throw err;

    return value;
  });
};

interface IMemEntry {
  value: string;
  expiresAt: number;
}

/**
 * Живое состояние с TTL, общее для процессов: последние снимки, счётчики,
 * отметки. Redis при наличии, иначе память процесса (single-process режим).
 * Модуль наследует класс со своим префиксом ключей и регистрирует
 * наследника в DI.
 */
export class LiveStore {
  private readonly _redis = getRedis();
  private readonly _mem = new Map<string, IMemEntry>();

  constructor(
    /** Префикс ключей модуля, например `stats:`. */
    private readonly _prefix: string,
  ) {}

  async getJson<T>(key: string): Promise<T | null> {
    if (this._redis) {
      const raw = await this._redis.get(this._prefix + key);

      return raw ? (JSON.parse(raw) as T) : null;
    }

    const entry = this._mem.get(key);

    if (!entry || entry.expiresAt < Date.now()) return null;

    return JSON.parse(entry.value) as T;
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    if (this._redis) {
      await this._redis.set(
        this._prefix + key,
        JSON.stringify(value),
        "EX",
        ttlSec,
      );

      return;
    }

    this._mem.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSec * 1000,
    });
    if (this._mem.size > MEM_PRUNE_AT) this._prune();
  }

  async delete(key: string): Promise<void> {
    if (this._redis) {
      await this._redis.del(this._prefix + key);

      return;
    }

    this._mem.delete(key);
  }

  /** Записать число, если ключа ещё нет; вернуть текущее значение. */
  async setIfAbsent(
    key: string,
    value: number,
    ttlSec: number,
  ): Promise<number> {
    if (this._redis) {
      await this._redis.set(
        this._prefix + key,
        String(value),
        "EX",
        ttlSec,
        "NX",
      );

      return Number((await this._redis.get(this._prefix + key)) ?? value);
    }

    const current = await this.getJson<number>(key);

    if (current === null) {
      await this.setJson(key, value, ttlSec);

      return value;
    }

    return current;
  }

  /** Атомарно прибавить к числу (между процессами — INCRBY); вернуть итог. */
  async incrBy(key: string, delta: number, ttlSec: number): Promise<number> {
    if (this._redis) {
      const total = await this._redis.incrby(
        this._prefix + key,
        Math.round(delta),
      );

      await this._redis.expire(this._prefix + key, ttlSec);

      return total;
    }

    const total = ((await this.getJson<number>(key)) ?? 0) + Math.round(delta);

    await this.setJson(key, total, ttlSec);

    return total;
  }

  /** Пакетное чтение JSON одним запросом (MGET); порядок — как у ключей. */
  async getJsonMany<T>(keys: readonly string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    if (this._redis) {
      const raws = await this._redis.mget(keys.map(key => this._prefix + key));

      return raws.map(raw => (raw ? (JSON.parse(raw) as T) : null));
    }

    return Promise.all(keys.map(key => this.getJson<T>(key)));
  }

  /** Пакетная запись JSON с общим TTL одним конвейером. */
  async setJsonMany(
    entries: ReadonlyArray<readonly [string, unknown]>,
    ttlSec: number,
  ): Promise<void> {
    if (entries.length === 0) return;
    if (this._redis) {
      const pipeline = this._redis.pipeline();

      for (const [key, value] of entries) {
        pipeline.set(this._prefix + key, JSON.stringify(value), "EX", ttlSec);
      }
      await execPipeline(pipeline);

      return;
    }

    for (const [key, value] of entries) await this.setJson(key, value, ttlSec);
  }

  /** Пакетный `setIfAbsent`: итоговые значения — в порядке записей. */
  async setIfAbsentMany(
    entries: ReadonlyArray<readonly [string, number]>,
    ttlSec: number,
  ): Promise<number[]> {
    if (entries.length === 0) return [];
    if (this._redis) {
      const pipeline = this._redis.pipeline();

      for (const [key, value] of entries) {
        pipeline.set(this._prefix + key, String(value), "EX", ttlSec, "NX");
      }
      for (const [key] of entries) pipeline.get(this._prefix + key);

      const results = await execPipeline(pipeline);

      return entries.map(([, value], index) =>
        Number(results[entries.length + index] ?? value),
      );
    }

    const totals: number[] = [];

    for (const [key, value] of entries) {
      totals.push(await this.setIfAbsent(key, value, ttlSec));
    }

    return totals;
  }

  /** Пакетный `incrBy`: итоги — в порядке записей. */
  async incrByMany(
    entries: ReadonlyArray<readonly [string, number]>,
    ttlSec: number,
  ): Promise<number[]> {
    if (entries.length === 0) return [];
    if (this._redis) {
      const pipeline = this._redis.pipeline();

      for (const [key, delta] of entries) {
        pipeline.incrby(this._prefix + key, Math.round(delta));
        pipeline.expire(this._prefix + key, ttlSec);
      }

      const results = await execPipeline(pipeline);

      return entries.map((_, index) => Number(results[index * 2]));
    }

    const totals: number[] = [];

    for (const [key, delta] of entries) {
      totals.push(await this.incrBy(key, delta, ttlSec));
    }

    return totals;
  }

  /**
   * Дописать значения в кольцевые ряды: в каждом ряду хранится не больше
   * `max` последних значений (история последних минут для графиков).
   */
  async pushCapped(
    entries: ReadonlyArray<readonly [string, unknown]>,
    max: number,
    ttlSec: number,
  ): Promise<void> {
    if (entries.length === 0) return;
    if (this._redis) {
      const pipeline = this._redis.pipeline();

      for (const [key, value] of entries) {
        pipeline.lpush(this._prefix + key, JSON.stringify(value));
        pipeline.ltrim(this._prefix + key, 0, max - 1);
        pipeline.expire(this._prefix + key, ttlSec);
      }
      await execPipeline(pipeline);

      return;
    }

    for (const [key, value] of entries) {
      const list =
        (await this.getJson<unknown[]>(`${LIST_PREFIX}${key}`)) ?? [];

      list.unshift(value);
      await this.setJson(`${LIST_PREFIX}${key}`, list.slice(0, max), ttlSec);
    }
  }

  /** Кольцевой ряд целиком, от старых значений к новым. */
  async listRecent<T>(key: string): Promise<T[]> {
    if (this._redis) {
      const raws = await this._redis.lrange(this._prefix + key, 0, -1);

      return raws.map(raw => JSON.parse(raw) as T).reverse();
    }

    const list = (await this.getJson<T[]>(`${LIST_PREFIX}${key}`)) ?? [];

    return [...list].reverse();
  }

  private _prune(): void {
    const now = Date.now();

    for (const [key, entry] of this._mem) {
      if (entry.expiresAt < now) this._mem.delete(key);
    }
  }
}
