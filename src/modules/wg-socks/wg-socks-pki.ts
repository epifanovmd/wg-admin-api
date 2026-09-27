import "reflect-metadata";

import { randomBytes, scrypt, webcrypto, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";

import * as x509 from "@peculiar/x509";

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const TEN_YEARS_MS = 3650 * 24 * 3600 * 1000;

/** Параметры scrypt для паролей SOCKS5 — те же проверяет агент. */
export const SOCKS_SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 } as const;

export interface IPemPair {
  certPem: string;
  keyPem: string;
}

x509.cryptoProvider.set(globalThis.crypto);

const exportKeyPem = async (key: webcrypto.CryptoKey): Promise<string> =>
  x509.PemConverter.encode(
    await globalThis.crypto.subtle.exportKey("pkcs8", key),
    "PRIVATE KEY",
  );

const serial = (): string => randomBytes(8).toString("hex");

/** Собственный CA прокси (ECDSA P-256). */
export const newCertificateAuthority = async (
  cn: string,
): Promise<IPemPair> => {
  const keys = await globalThis.crypto.subtle.generateKey(ALG, true, [
    "sign",
    "verify",
  ]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=${cn}`,
    keys,
    signingAlgorithm: ALG,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS),
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });

  return {
    certPem: cert.toString("pem"),
    keyPem: await exportKeyPem(keys.privateKey),
  };
};

/** Сертификат, подписанный CA: серверный (SNI) или клиентский (mTLS). */
export const issueCertificate = async (
  ca: IPemPair,
  cn: string,
  purpose: "server" | "client",
): Promise<IPemPair> => {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    x509.PemConverter.decodeFirst(ca.keyPem),
    ALG,
    false,
    ["sign"],
  );
  const keys = await globalThis.crypto.subtle.generateKey(ALG, true, [
    "sign",
    "verify",
  ]);
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${cn}`,
    issuer: caCert.subject,
    publicKey: keys.publicKey,
    signingKey: caKey,
    signingAlgorithm: ALG,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS),
    extensions: [
      new x509.ExtendedKeyUsageExtension([
        purpose === "server"
          ? x509.ExtendedKeyUsage.serverAuth
          : x509.ExtendedKeyUsage.clientAuth,
      ]),
      ...(purpose === "server"
        ? [
            new x509.SubjectAlternativeNameExtension([
              { type: isIP(cn) ? "ip" : "dns", value: cn },
            ]),
          ]
        : []),
    ],
  });

  return {
    certPem: cert.toString("pem"),
    keyPem: await exportKeyPem(keys.privateKey),
  };
};

/** SHA-256 отпечаток сертификата (hex, нижний регистр) — allowlist агента. */
export const certFingerprint = (certPem: string): string =>
  new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase();

/** Серверный сертификат выписан на это имя (SAN/CN). */
export const certMatchesHost = (certPem: string, host: string): boolean => {
  const cert = new X509Certificate(certPem);

  return (isIP(host) ? cert.checkIP(host) : cert.checkHost(host)) !== undefined;
};

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** Хэш пароля для агента: пароль в открытом виде на ноду не уходит. */
export const hashSocksPassword = async (
  password: string,
): Promise<{ salt: string; hash: string }> => {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SOCKS_SCRYPT.keyLength, {
    N: SOCKS_SCRYPT.N,
    r: SOCKS_SCRYPT.r,
    p: SOCKS_SCRYPT.p,
  });

  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
};
