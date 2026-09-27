import { expect } from "chai";

import { resolveSecretsKey } from "./wg.config";

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
