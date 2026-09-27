import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { hashToken } from "../../core";
import { createMockRepository, uuid } from "../../test/helpers";
import { ResetPasswordTokensService } from "./reset-password-tokens.service";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("ResetPasswordTokensService", () => {
  let service: ResetPasswordTokensService;
  let repo: ReturnType<typeof createMockRepository> & Record<string, any>;

  const userId = uuid();
  const future = () => new Date(Date.now() + 60_000);

  beforeEach(() => {
    repo = createMockRepository() as any;
    repo.findByUserId = sinon.stub().resolves(null);
    repo.findByTokenHash = sinon.stub().resolves(null);
    repo.upsert = sinon.stub().resolves();

    service = new ResetPasswordTokensService(repo as any);
  });

  describe("create", () => {
    it("issues an opaque token and stores only its sha256 hash", async () => {
      const result = await service.create(userId);

      expect(result).to.not.be.null;
      const { token } = result!;

      // Не JWT: нет точек-разделителей, 32 случайных байта в base64url
      expect(token).to.not.include(".");
      expect(Buffer.from(token, "base64url")).to.have.length(32);

      const [saved] = repo.upsert.firstCall.args;

      expect(saved.userId).to.equal(userId);
      expect(saved.tokenHash).to.equal(hashToken(token));
      expect(saved).to.not.have.property("token");
      expect(saved.expiresAt.getTime()).to.be.greaterThan(Date.now());
    });

    it("issues a different token each time", async () => {
      const a = await service.create(userId);

      repo.findByUserId.resolves({
        userId,
        issuedAt: new Date(Date.now() - 120_000),
      });
      const b = await service.create(userId);

      expect(a!.token).to.not.equal(b!.token);
    });

    it("returns null within the resend cooldown", async () => {
      repo.findByUserId.resolves({ userId, issuedAt: new Date() });

      expect(await service.create(userId)).to.be.null;
      expect(repo.upsert.called).to.be.false;
    });
  });

  describe("check", () => {
    it("looks up by hash, consumes the token and returns userId", async () => {
      const token = "opaque-token";
      const tokenHash = hashToken(token);

      repo.findByTokenHash.resolves({ userId, tokenHash, expiresAt: future() });

      const result = await service.check(token);

      expect(repo.findByTokenHash.calledOnceWith(tokenHash)).to.be.true;
      expect(repo.delete.calledOnceWith({ userId, tokenHash })).to.be.true;
      expect(result.userId).to.equal(userId);
    });

    it("rejects an unknown token with 400", async () => {
      const err = await expectRejected(service.check("unknown"));

      expect(err).to.include({
        status: 400,
        code: "AUTH_RESET_TOKEN_INVALID",
      });
    });

    it("rejects an expired token with 400 and deletes it", async () => {
      repo.findByTokenHash.resolves({
        userId,
        tokenHash: hashToken("t"),
        expiresAt: new Date(Date.now() - 1_000),
      });

      const err = await expectRejected(service.check("t"));

      expect(err).to.include({
        status: 400,
        code: "AUTH_RESET_TOKEN_INVALID",
      });
      expect(repo.delete.calledOnce).to.be.true;
    });

    it("lets only one of two concurrent checks through", async () => {
      repo.findByTokenHash.resolves({
        userId,
        tokenHash: hashToken("t"),
        expiresAt: future(),
      });
      repo.delete.onFirstCall().resolves({ affected: 1 });
      repo.delete.onSecondCall().resolves({ affected: 0 });

      const results = await Promise.allSettled([
        service.check("t"),
        service.check("t"),
      ]);

      expect(results.filter(r => r.status === "fulfilled")).to.have.length(1);
      const rejected = results.find(r => r.status === "rejected");

      expect((rejected as PromiseRejectedResult).reason).to.include({
        code: "AUTH_RESET_TOKEN_INVALID",
      });
    });
  });

  describe("peek", () => {
    it("returns the owner without consuming the token", async () => {
      repo.findByTokenHash.resolves({
        userId,
        tokenHash: hashToken("t"),
        expiresAt: future(),
      });

      expect(await service.peek("t")).to.deep.equal({ userId });
      expect(repo.delete.called).to.be.false;
    });

    it("rejects an expired token", async () => {
      repo.findByTokenHash.resolves({
        userId,
        tokenHash: hashToken("t"),
        expiresAt: new Date(Date.now() - 1),
      });

      const err = await expectRejected(service.peek("t"));

      expect(err).to.include({ code: "AUTH_RESET_TOKEN_INVALID" });
    });
  });
});
