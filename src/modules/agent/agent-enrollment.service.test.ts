import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { hashToken } from "../../core";
import { agentConfig } from "./agent.config";
import {
  AgentEnrollmentService,
  parseEnrollmentToken,
} from "./agent-enrollment.service";

const BOOTSTRAP = "b".repeat(40);

describe("AgentEnrollmentService", () => {
  let tokens: Record<string, sinon.SinonStub>;
  let service: AgentEnrollmentService;
  let saved: string | undefined;

  beforeEach(() => {
    saved = agentConfig.bootstrapToken;
    agentConfig.bootstrapToken = BOOTSTRAP;
    tokens = {
      createAndSave: sinon.stub().callsFake(async (data: object) => ({
        id: "t1",
        createdAt: new Date(),
        ...data,
      })),
      findById: sinon.stub().resolves(null),
      findByPrefix: sinon.stub().resolves(null),
      findPage: sinon.stub().resolves([[], 0]),
      consume: sinon.stub().resolves(true),
      revoke: sinon.stub().resolves(true),
    };
    service = new AgentEnrollmentService(tokens as any);
  });

  afterEach(() => {
    agentConfig.bootstrapToken = saved;
  });

  it("parseEnrollmentToken: <prefix>.<secret>", () => {
    expect(parseEnrollmentToken("abc.def.g")).to.deep.equal({
      prefix: "abc",
      secret: "def.g",
    });
    expect(parseEnrollmentToken("abc")).to.equal(null);
    expect(parseEnrollmentToken(".x")).to.equal(null);
    expect(parseEnrollmentToken("x.")).to.equal(null);
  });

  it("выпуск: токен показывается один раз, в БД — префикс и хеш", async () => {
    const created = await service.createToken("u1", {
      name: "парк",
      labels: { zone: "eu" },
      maxUses: 3,
    });
    const [prefix, secret] = created.token.split(".");
    const saved = tokens.createAndSave.firstCall.args[0];

    expect(prefix).to.have.length(8);
    expect(saved).to.include({ prefix, hash: hashToken(secret), maxUses: 3 });
    expect(saved.createdBy).to.equal("u1");
    expect(JSON.stringify(created.enrollmentToken)).to.not.include(secret);
  });

  it("регистрация: общий токен окружения — без меток и без БД", async () => {
    expect(await service.enroll(BOOTSTRAP, { name: "n" })).to.deep.equal({});
    expect(tokens.findByPrefix.called).to.be.false;
  });

  it("регистрация: токен из БД — его метки, использование учтено", async () => {
    tokens.findByPrefix.resolves({
      id: "t1",
      hash: hashToken("secret"),
      labels: { gpu: "1" },
    });

    expect(await service.enroll("pref.secret", { name: "n" })).to.deep.equal({
      labels: { gpu: "1" },
    });
    expect(tokens.consume.calledOnceWith("t1")).to.be.true;
  });

  it("регистрация: неверный секрет, исчерпанный или отозванный токен — отказ", async () => {
    tokens.findByPrefix.resolves({
      id: "t1",
      hash: hashToken("secret"),
      labels: {},
    });

    expect(await service.enroll("pref.wrong", { name: "n" })).to.equal(null);
    expect(tokens.consume.called).to.be.false;

    tokens.consume.resolves(false);
    expect(await service.enroll("pref.secret", { name: "n" })).to.equal(null);
    expect(await service.enroll("garbage", { name: "n" })).to.equal(null);
  });

  it("источник регистрации: только в контексте запроса и один раз", async () => {
    tokens.findByPrefix.resolves({
      id: "t1",
      hash: hashToken("secret"),
      labels: { nodeId: "n1" },
      createdBy: "u1",
    });

    const taken = await service.withContext(async () => {
      await service.enroll("pref.secret", { name: "n" });

      return [service.takeSource(), service.takeSource()];
    });

    expect(taken).to.deep.equal([
      { tokenId: "t1", createdBy: "u1", labels: { nodeId: "n1" } },
      null,
    ]);

    const bootstrap = await service.withContext(async () => {
      await service.enroll(BOOTSTRAP, { name: "n" });

      return service.takeSource();
    });

    expect(bootstrap).to.deep.equal({
      tokenId: null,
      createdBy: null,
      labels: {},
    });

    await service.enroll("pref.secret", { name: "n" });
    expect(service.takeSource(), "вне контекста").to.equal(null);
  });

  it("отзыв: нет токена — 404", async () => {
    try {
      await service.revokeToken("t404");
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("AGENT_ENROLLMENT_TOKEN_NOT_FOUND");
    }

    tokens.findById.resolves({ id: "t1" });
    await service.revokeToken("t1");
    expect(tokens.revoke.calledOnceWith("t1")).to.be.true;
  });
});
