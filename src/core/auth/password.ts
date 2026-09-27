import bcrypt from "bcrypt";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";

/**
 * Хеш пароля на встроенном scrypt: без нативных зависимостей и с
 * параметрами, которые можно менять — они записаны в самом хеше:
 * `scrypt$<N>$<salt>$<hash>` (base64url). Старые bcrypt-хеши (`$2…`)
 * по-прежнему проверяются, чтобы никого не выкидывать при обновлении.
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const COST = 16384;

const derive = (
  password: string,
  salt: Buffer,
  cost: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: cost }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST);

  return [
    "scrypt",
    String(COST),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
};

/** Хеш выдан bcrypt — до перехода на scrypt. */
export const isLegacyHash = (stored: string): boolean =>
  stored.startsWith("$2");

/** Сравнение постоянного времени; битый хеш — просто «не совпало». */
export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<boolean> => {
  if (isLegacyHash(stored)) return bcrypt.compare(password, stored);

  const [algo, costRaw, saltRaw, keyRaw] = stored.split("$");

  if (algo !== "scrypt" || !costRaw || !saltRaw || !keyRaw) return false;

  const cost = Number(costRaw);

  if (!Number.isInteger(cost) || cost <= 0) return false;

  const expected = Buffer.from(keyRaw, "base64url");
  const actual = await derive(
    password,
    Buffer.from(saltRaw, "base64url"),
    cost,
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
