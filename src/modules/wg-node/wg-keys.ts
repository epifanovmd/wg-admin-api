import { createPrivateKey, createPublicKey, randomBytes } from "crypto";

/** Ключ WireGuard: 32 байта в base64 (44 символа с `=`). */
export const WG_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

const PKCS8_X25519_PREFIX = Buffer.from(
  "302e020100300506032b656e04220420",
  "hex",
);

/** Клампинг скаляра X25519 — как это делает `wg genkey`. */
const clamp = (raw: Buffer): Buffer => {
  /* eslint-disable no-bitwise -- клампинг X25519 по спецификации */
  raw[0] &= 248;
  raw[31] &= 127;
  raw[31] |= 64;
  /* eslint-enable no-bitwise */

  return raw;
};

export interface IWgKeyPair {
  privateKey: string;
  publicKey: string;
}

/** Публичный ключ WireGuard из приватного (X25519, без вызова `wg`). */
export const deriveWgPublicKey = (privateKeyBase64: string): string => {
  const raw = Buffer.from(privateKeyBase64, "base64");

  if (raw.length !== 32) {
    throw new Error("Приватный ключ WireGuard — 32 байта в base64");
  }

  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_X25519_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });

  return Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
};

/** Пара ключей WireGuard — эквивалент `wg genkey | tee ... | wg pubkey`. */
export const generateWgKeyPair = (): IWgKeyPair => {
  const privateKey = clamp(randomBytes(32)).toString("base64");

  return { privateKey, publicKey: deriveWgPublicKey(privateKey) };
};

/** PSK — эквивалент `wg genpsk`. */
export const generateWgPresharedKey = (): string =>
  randomBytes(32).toString("base64");
