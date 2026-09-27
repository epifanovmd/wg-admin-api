import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = "v1";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Ключ симметричного шифрования секретов: ровно 32 байта,
 * hex (64 символа) или base64.
 */
export const parseSecretBoxKey = (raw: string): Buffer => {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");

  const decoded = Buffer.from(trimmed, "base64");

  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      "Ключ шифрования секретов должен быть 32 байта (hex или base64)",
    );
  }

  return decoded;
};

/** Зашифровать секрет: AES-256-GCM, формат `v1:<base64(iv|tag|ciphertext)>`. */
export const sealSecret = (plain: string, key: Buffer): string => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);

  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
};

/** Расшифровать секрет, созданный `sealSecret`; порча данных — исключение. */
export const openSecret = (sealed: string, key: Buffer): string => {
  const separator = sealed.indexOf(":");
  const version = sealed.slice(0, separator);
  const payload = sealed.slice(separator + 1);

  if (version !== VERSION || !payload) {
    throw new Error("Неверный формат зашифрованного секрета");
  }

  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    raw.subarray(0, IV_LENGTH),
  );

  decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

  return Buffer.concat([
    decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
};
