import { Redis } from "ioredis";

import { config } from "../../config";
import { logger } from "../logger/logger.service";

let shared: Redis | undefined;

/** Общий Redis настроен (`REDIS_URL`): состояние делится между репликами. */
export const isRedisConfigured = (): boolean => !!config.redis.url;

/**
 * Отдельное соединение — для pub/sub и адаптера Socket.IO, которым нужны
 * выделенные клиенты. Ошибки соединения логируются, ioredis переподключается сам.
 * `prefixKeys: false` — без `REDIS_KEY_PREFIX` у команд: клиент сам задаёт
 * полные имена (ioredis иначе добавляет префикс и к шардированным каналам).
 */
export const createRedisClient = (
  purpose: string,
  { prefixKeys = true }: { prefixKeys?: boolean } = {},
): Redis => {
  const url = config.redis.url;

  if (!url) {
    throw new Error("REDIS_URL is not configured");
  }

  const client = new Redis(url, {
    connectionName: `${config.app.name}:${purpose}`,
    // Изоляция проекта в общем Redis: ключи `<REDIS_KEY_PREFIX>*`.
    keyPrefix: (prefixKeys && config.redis.keyPrefix) || undefined,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  client.on("error", err => logger.error({ err, purpose }, "Redis error"));

  return client;
};

/** Общий клиент для обычных команд (лимиты, кэши); `undefined` без Redis. */
export const getRedis = (): Redis | undefined => {
  if (!isRedisConfigured()) return undefined;

  shared ??= createRedisClient("shared");

  return shared;
};

export const closeRedis = async (): Promise<void> => {
  const client = shared;

  shared = undefined;
  await client?.quit().catch(() => client.disconnect());
};
