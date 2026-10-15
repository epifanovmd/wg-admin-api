import { expect } from "chai";

import { resolveSecretsKey, wgConfigSchema } from "./wg.config";

describe("wgConfig: ключ секретов", () => {
  it("пустая переменная вне production — производный dev-ключ", () => {
    const key = resolveSecretsKey("", false);

    expect(key).to.match(/^[0-9a-f]{64}$/);
    expect(resolveSecretsKey(undefined, false)).to.equal(key);
  });

  it("пустая переменная в production — пусто (старт падает на схеме)", () => {
    expect(resolveSecretsKey("", true)).to.equal("");
    expect(resolveSecretsKey(undefined, true)).to.equal("");
  });

  it("заданный ключ используется как есть", () => {
    expect(resolveSecretsKey("abc", false)).to.equal("abc");
    expect(resolveSecretsKey("abc", true)).to.equal("abc");
  });
});

describe("wgConfig: подсеть туннелей релеев", () => {
  const parse = (relayTunnelCidr: string | undefined) =>
    wgConfigSchema.safeParse({ secretsKey: "key", relayTunnelCidr });

  it("по умолчанию и заданный IPv4 CIDR принимаются", () => {
    expect(parse(undefined).success).to.equal(true);
    expect(parse("10.50.0.0/16").success).to.equal(true);
  });

  it("некорректный CIDR — ошибка старта, а не 500 при создании связи", () => {
    for (const value of [
      "10.99.0.0",
      "10.99.0.0/33",
      "relay",
      "300.1.1.1/16",
    ]) {
      expect(parse(value).success, value).to.equal(false);
    }
  });
});
