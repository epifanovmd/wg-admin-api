import "reflect-metadata";

import { expect } from "chai";
import { createPrivateKey, X509Certificate } from "crypto";

import {
  certFingerprint,
  certMatchesHost,
  hashSocksPassword,
  issueCertificate,
  newCertificateAuthority,
} from "./wg-socks-pki";

describe("wg-socks-pki", () => {
  it("CA выпускает серверный и клиентский сертификаты: подписаны им, ключи от них", async () => {
    const ca = await newCertificateAuthority("proxy-ca");
    const other = await newCertificateAuthority("other-ca");
    const caCert = new X509Certificate(ca.certPem);

    for (const role of ["server", "client"] as const) {
      const issued = await issueCertificate(ca, "vps", role);
      const cert = new X509Certificate(issued.certPem);

      expect(cert.verify(caCert.publicKey)).to.equal(true);
      expect(
        cert.verify(new X509Certificate(other.certPem).publicKey),
      ).to.equal(false);
      expect(cert.checkPrivateKey(createPrivateKey(issued.keyPem))).to.equal(
        true,
      );
    }
    expect(
      certFingerprint((await issueCertificate(ca, "c", "client")).certPem),
    ).to.match(/^[0-9a-f]{64}$/);
  });

  it("пароль — scrypt с солью; агенту уходит только хэш", async () => {
    const a = await hashSocksPassword("secret");
    const b = await hashSocksPassword("secret");

    expect(a.salt).to.not.equal(b.salt);
    expect(a.hash).to.match(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).to.not.include("secret");
  });

  it("имя сервера в сертификате: DNS и IP в SAN, проверка имени", async () => {
    const ca = await newCertificateAuthority("test-ca");
    const byIp = await issueCertificate(ca, "203.0.113.7", "server");
    const byName = await issueCertificate(ca, "proxy.example", "server");

    expect(certMatchesHost(byIp.certPem, "203.0.113.7")).to.equal(true);
    expect(certMatchesHost(byName.certPem, "proxy.example")).to.equal(true);
    expect(certMatchesHost(byName.certPem, "other.example")).to.equal(false);
  });
});
