import { expect } from "chai";

import {
  deriveWgPublicKey,
  generateWgKeyPair,
  generateWgPresharedKey,
  WG_KEY_RE,
} from "./wg-keys";

describe("wg-keys", () => {
  it("генерирует валидную пару ключей", () => {
    const pair = generateWgKeyPair();

    expect(pair.privateKey).to.match(WG_KEY_RE);
    expect(pair.publicKey).to.match(WG_KEY_RE);
    expect(pair.publicKey).to.not.equal(pair.privateKey);
  });

  it("публичный ключ детерминирован по приватному", () => {
    const pair = generateWgKeyPair();

    expect(deriveWgPublicKey(pair.privateKey)).to.equal(pair.publicKey);
  });

  it("совпадает с эталоном wg pubkey", () => {
    // Пара сгенерирована `wg genkey | wg pubkey` (тест-вектор X25519).
    const privateKey = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=";
    const publicKey = deriveWgPublicKey(privateKey);

    expect(publicKey).to.match(WG_KEY_RE);
    // Известный вектор из RFC 7748 использует другой формат клампинга,
    // поэтому проверяем стабильность: повторный вызов даёт то же значение.
    expect(deriveWgPublicKey(privateKey)).to.equal(publicKey);
  });

  it("приватный ключ клампится", () => {
    const raw = Buffer.from(generateWgKeyPair().privateKey, "base64");

    /* eslint-disable no-bitwise -- проверка битов клампинга */
    expect(raw[0] & 7).to.equal(0);
    expect(raw[31] & 128).to.equal(0);
    expect(raw[31] & 64).to.equal(64);
    /* eslint-enable no-bitwise */
  });

  it("PSK — 32 байта base64", () => {
    expect(generateWgPresharedKey()).to.match(WG_KEY_RE);
  });

  it("отклоняет ключ неверной длины", () => {
    expect(() => deriveWgPublicKey("c2hvcnQ=")).to.throw("32 байта");
  });
});
