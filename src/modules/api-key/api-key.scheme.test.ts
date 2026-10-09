import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { HttpException } from "../../core";
import { ApiKeyError } from "./api-key.errors";
import { ApiKeySecurityScheme } from "./api-key.scheme";
import { scopeSatisfied } from "./api-key.scopes";

const request = (headers: Record<string, string>) => ({ headers }) as any;

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail("должно было упасть");
  } catch (err) {
    expect(err).to.be.instanceOf(HttpException);
    expect((err as HttpException).code).to.equal(code);
  }
};

describe("ApiKeySecurityScheme", () => {
  const keys = { verify: sinon.stub() };
  const scheme = new ApiKeySecurityScheme(keys as any);
  const apiKey = { id: "k1", ownerId: "u1", scopes: ["integration:sync"] };

  beforeEach(() => {
    keys.verify.reset();
    keys.verify.resolves(apiKey);
  });

  it("без ключа — 401 APIKEY_REQUIRED", async () => {
    await expectCode(
      scheme.authenticate(request({}), []),
      ApiKeyError.codes.REQUIRED,
    );
  });

  it("ключ из X-Api-Key — контекст сервиса со scopes ключа", async () => {
    const ctx = await scheme.authenticate(
      request({ "x-api-key": "abcdefgh.secret" }),
      ["integration"],
    );

    expect(keys.verify.calledWith("abcdefgh.secret")).to.be.true;
    expect(ctx).to.deep.equal({
      kind: "service",
      userId: "u1",
      sessionId: "apikey:k1",
      roles: [],
      permissions: ["integration:sync"],
      emailVerified: true,
    });
  });

  it("ключ из Authorization: ApiKey …", async () => {
    await scheme.authenticate(
      request({ authorization: "ApiKey abcdefgh.secret" }),
      [],
    );
    expect(keys.verify.calledWith("abcdefgh.secret")).to.be.true;
  });

  it("Bearer-токен ключом не считается", async () => {
    await expectCode(
      scheme.authenticate(request({ authorization: "Bearer jwt" }), []),
      ApiKeyError.codes.REQUIRED,
    );
  });

  it("scope не покрыт — 403 APIKEY_SCOPE_DENIED", async () => {
    await expectCode(
      scheme.authenticate(request({ "x-api-key": "k" }), ["billing:read"]),
      ApiKeyError.codes.SCOPE_DENIED,
    );
  });

  it("неверный ключ — ошибка verify пробрасывается", async () => {
    keys.verify.rejects(ApiKeyError.INVALID());
    await expectCode(
      scheme.authenticate(request({ "x-api-key": "k" }), []),
      ApiKeyError.codes.INVALID,
    );
  });
});

describe("scopeSatisfied", () => {
  it("точное совпадение и wildcard", () => {
    expect(scopeSatisfied(["integration:sync"], "integration:sync")).to.be.true;
    expect(scopeSatisfied(["integration:*"], "integration:sync")).to.be.true;
    expect(scopeSatisfied(["*"], "integration:sync")).to.be.true;
    expect(scopeSatisfied(["integration:other"], "integration:sync")).to.be
      .false;
  });

  it("требование без действия — любой scope домена", () => {
    expect(scopeSatisfied(["integration:sync"], "integration")).to.be.true;
    expect(scopeSatisfied(["integration:*"], "integration")).to.be.true;
    expect(scopeSatisfied(["integrations:x"], "integration")).to.be.false;
    expect(scopeSatisfied([], "integration")).to.be.false;
  });
});
