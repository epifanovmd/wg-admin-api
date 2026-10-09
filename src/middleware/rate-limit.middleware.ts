import type { Redis } from "ioredis";
import Koa from "koa";
import RateLimit from "koa-ratelimit";

import { config } from "../config";
import { logger } from "../core/logger/logger.service";
import { getRedis } from "../core/redis/redis";

export interface RateLimitOptions {
  /** Запросов за окно; без значения — умолчание koa-ratelimit. */
  limit?: number;
  intervalMs?: number;
  /** Redis для общих счётчиков нескольких реплик; без него — память процесса. */
  redis?: Redis;
  /** Запросы, которые лимит не считает. */
  skip?: (ctx: Koa.Context) => boolean;
}

/**
 * Глобальный лимит запросов по IP клиента (`ctx.ip` учитывает `trustProxy`).
 * Память годится для одного инстанса; за балансировщиком счётчики в Redis.
 * Недоступный Redis не блокирует трафик: лимит пропускает запрос с
 * предупреждением в логе (fail-open).
 */
export const createRateLimitMiddleware = ({
  limit,
  intervalMs,
  redis,
  skip,
}: RateLimitOptions): Koa.Middleware => {
  const common = { duration: intervalMs, max: limit };

  // koa-ratelimit тянет собственные типы koa — приводим к нашим.
  const limiter = (redis
    ? RateLimit({ ...common, driver: "redis", db: redis })
    : RateLimit({
        ...common,
        driver: "memory",
        db: new Map(),
      })) as unknown as Koa.Middleware;

  return async (ctx, next) => {
    if (skip?.(ctx)) return next();

    // Ошибки ниже по цепочке — не наши: пробрасываем как есть. Fail-open
    // только если упало хранилище лимита, т.е. до вызова next.
    let passed = false;
    const downstream = () => {
      passed = true;

      return next();
    };

    try {
      await limiter(ctx, downstream);
    } catch (err) {
      if (passed || (err as { status?: number }).status === 429) throw err;

      logger.warn({ err }, "Rate limit store unavailable, request allowed");
      await next();
    }
  };
};

export const rateLimitMiddleware = createRateLimitMiddleware({
  ...config.rateLimit,
  redis: getRedis(),
});
