import { expect } from "chai";

import { openSecret, parseSecretBoxKey, sealSecret } from "./secret-box";

describe("secret-box", () => {
  const key = parseSecretBoxKey("a".repeat(64));

  it("шифрует и расшифровывает секрет", () => {
    const sealed = sealSecret("wg-private-key", key);

    expect(sealed.startsWith("v1:")).to.be.true;
    expect(sealed).to.not.include("wg-private-key");
    expect(openSecret(sealed, key)).to.equal("wg-private-key");
  });

  it("каждый вызов даёт разный шифртекст (случайный IV)", () => {
    expect(sealSecret("x", key)).to.not.equal(sealSecret("x", key));
  });

  it("принимает ключ в base64", () => {
    const b64 = Buffer.alloc(32, 7).toString("base64");

    expect(parseSecretBoxKey(b64)).to.have.length(32);
  });

  it("отклоняет ключ неверной длины", () => {
    expect(() => parseSecretBoxKey("short")).to.throw("32 байта");
  });

  it("порча данных — ошибка аутентификации", () => {
    const sealed = sealSecret("secret", key);
    const raw = Buffer.from(sealed.slice(3), "base64");

    // eslint-disable-next-line no-bitwise -- порча байта шифртекста
    raw[raw.length - 1] ^= 0xff;

    expect(() => openSecret(`v1:${raw.toString("base64")}`, key)).to.throw();
  });

  it("чужой ключ не расшифровывает", () => {
    const other = parseSecretBoxKey("b".repeat(64));

    expect(() => openSecret(sealSecret("secret", key), other)).to.throw();
  });

  it("неверный формат — ошибка", () => {
    expect(() => openSecret("v2:abc", key)).to.throw("формат");
    expect(() => openSecret("garbage", key)).to.throw("формат");
  });
});
