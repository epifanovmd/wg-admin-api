import { createHash, timingSafeEqual } from "crypto";

/**
 * Хеш секрета для хранения в БД (refresh-токен, токен сброса пароля):
 * утечка таблицы не даёт использовать сами токены. Поиск — по хешу.
 */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Длина hex-представления sha256 — под размер колонки. */
export const TOKEN_HASH_LENGTH = 64;

/** Секрет соответствует сохранённому хешу; сравнение за постоянное время. */
export const tokenHashMatches = (token: string, hash: string): boolean => {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(hash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
