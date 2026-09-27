import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { createMockRepository, uuid } from "../../test/helpers";
import { OTP_MAX_ATTEMPTS, OtpService } from "./otp.service";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("OtpService", () => {
  let service: OtpService;
  let otpRepo: ReturnType<typeof createMockRepository> & Record<string, any>;

  const userId = uuid();
  const future = () => new Date(Date.now() + 600_000);

  beforeEach(() => {
    otpRepo = createMockRepository() as any;
    otpRepo.findByUserId = sinon.stub().resolves(null);
    otpRepo.upsert = sinon.stub().resolves();
    otpRepo.incrementAttempts = sinon.stub().resolves(1);

    service = new OtpService(otpRepo as any);
  });

  describe("create", () => {
    it("generates a 6-digit code and upserts it with reset attempts", async () => {
      const result = await service.create(userId);

      expect(result.code).to.match(/^\d{6}$/);

      const [saved] = otpRepo.upsert.firstCall.args;

      expect(saved.userId).to.equal(userId);
      expect(saved.code).to.equal(result.code);
      expect(saved.attempts).to.equal(0);
      expect(saved.expireAt.getTime()).to.be.greaterThan(Date.now());
    });

    it("refuses to resend within 60 seconds", async () => {
      otpRepo.findByUserId.resolves({ userId, sentAt: new Date() });

      const err = await expectRejected(service.create(userId));

      expect(err).to.include({ status: 429, code: "OTP_RESEND_COOLDOWN" });
      expect(otpRepo.upsert.called).to.be.false;
    });

    it("resends after the cooldown", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        sentAt: new Date(Date.now() - 61_000),
      });

      await service.create(userId);

      expect(otpRepo.upsert.calledOnce).to.be.true;
    });
  });

  describe("check", () => {
    it("returns true and consumes the code", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: 0,
        expireAt: future(),
      });

      expect(await service.check(userId, "123456")).to.be.true;
      expect(otpRepo.delete.calledOnceWith({ userId, code: "123456" })).to.be
        .true;
    });

    it("rejects when there is no code", async () => {
      const err = await expectRejected(service.check(userId, "000000"));

      expect(err).to.include({ status: 400, code: "OTP_INVALID_CODE" });
    });

    it("rejects an expired code with 400 (not 410/500) and deletes it", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: 0,
        expireAt: new Date(Date.now() - 60_000),
      });

      const err = await expectRejected(service.check(userId, "123456"));

      expect(err).to.include({ status: 400, code: "OTP_CODE_EXPIRED" });
      expect(otpRepo.delete.calledOnceWith({ userId })).to.be.true;
    });

    it("counts a wrong code as an attempt", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: 0,
        expireAt: future(),
      });

      const err = await expectRejected(service.check(userId, "000000"));

      expect(err).to.include({ status: 400, code: "OTP_INVALID_CODE" });
      expect(otpRepo.incrementAttempts.calledOnceWith(userId)).to.be.true;
      expect(otpRepo.delete.called).to.be.false;
    });

    it("deletes the code after the last allowed attempt", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: OTP_MAX_ATTEMPTS - 1,
        expireAt: future(),
      });
      otpRepo.incrementAttempts.resolves(OTP_MAX_ATTEMPTS);

      const err = await expectRejected(service.check(userId, "000000"));

      expect(err).to.include({ status: 400, code: "OTP_ATTEMPTS_EXHAUSTED" });
      expect(otpRepo.delete.calledOnceWith({ userId })).to.be.true;
    });

    it("rejects even the right code once attempts are exhausted", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: OTP_MAX_ATTEMPTS,
        expireAt: future(),
      });

      const err = await expectRejected(service.check(userId, "123456"));

      expect(err).to.include({ status: 400, code: "OTP_ATTEMPTS_EXHAUSTED" });
      expect(otpRepo.delete.calledOnceWith({ userId })).to.be.true;
    });

    it("lets only one of two concurrent checks through", async () => {
      otpRepo.findByUserId.resolves({
        userId,
        code: "123456",
        attempts: 0,
        expireAt: future(),
      });
      otpRepo.delete.onFirstCall().resolves({ affected: 1 });
      otpRepo.delete.onSecondCall().resolves({ affected: 0 });

      const results = await Promise.allSettled([
        service.check(userId, "123456"),
        service.check(userId, "123456"),
      ]);

      expect(results.filter(r => r.status === "fulfilled")).to.have.length(1);
    });
  });
});
