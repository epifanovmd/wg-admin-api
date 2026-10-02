import "reflect-metadata";

import { expect } from "chai";
import { createSign, generateKeyPairSync } from "crypto";
import sinon from "sinon";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
} from "../../test/helpers";
import { BiometricService } from "./biometric.service";
import { BiometricAddedEvent, BiometricRemovedEvent } from "./events";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("BiometricService", () => {
  let service: BiometricService;
  let biometricRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let userService: Record<string, sinon.SinonStub>;
  let authService: Record<string, sinon.SinonStub>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  const userId = uuid();
  const deviceId = "device-001";

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicKeyBase64 = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const sign = (message: string) =>
    createSign("SHA256").update(message).end().sign(privateKey, "base64");

  const makeBiometric = (overrides: Record<string, unknown> = {}) => ({
    id: "bio-1",
    userId,
    deviceId,
    deviceName: "iPhone",
    publicKey: publicKeyBase64,
    challenge: "nonce-1" as string | null,
    challengeExpiresAt: new Date(Date.now() + 60_000) as Date | null,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    biometricRepo = createMockRepository() as any;
    biometricRepo.findByUserIdAndDeviceId = sinon.stub().resolves(null);
    biometricRepo.countByUserId = sinon.stub().resolves(0);
    biometricRepo.findByUserId = sinon.stub().resolves([]);
    biometricRepo.deleteByUserIdAndDeviceId = sinon
      .stub()
      .resolves({ affected: 1 });
    biometricRepo.consumeChallenge = sinon.stub().resolves(true);

    userService = { getUser: sinon.stub().resolves({ id: userId }) };
    authService = {
      completeLogin: sinon.stub().resolves({
        id: userId,
        tokens: { accessToken: "at", refreshToken: "rt" },
      }),
    };
    eventBus = createMockEventBus();

    service = new BiometricService(
      userService as any,
      biometricRepo as any,
      authService as any,
      eventBus as any,
    );
  });

  describe("registerBiometric", () => {
    it("updates an existing device", async () => {
      const existing = makeBiometric();

      biometricRepo.findByUserIdAndDeviceId.resolves(existing);

      await service.registerBiometric(userId, deviceId, "New", "bmV3LWtleQ==");

      expect(existing.publicKey).to.equal("bmV3LWtleQ==");
      expect(existing.deviceName).to.equal("New");
      expect(biometricRepo.save.calledOnce).to.be.true;
    });

    it("creates a new device and emits BiometricAddedEvent", async () => {
      await service.registerBiometric(userId, deviceId, "iPhone", "a2V5");

      expect(biometricRepo.createAndSave.calledOnce).to.be.true;
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        BiometricAddedEvent,
      );
    });

    it("rejects beyond the device limit with 409", async () => {
      biometricRepo.countByUserId.resolves(5);

      const err = await expectRejected(
        service.registerBiometric(userId, deviceId, "iPhone", "a2V5"),
      );

      expect(err).to.include({ status: 409, code: "BIOMETRIC_DEVICE_LIMIT" });
    });
  });

  describe("generateNonce", () => {
    it("stores a nonce with TTL for a registered device", async () => {
      const biometric = makeBiometric({ challenge: null });

      biometricRepo.findByUserIdAndDeviceId.resolves(biometric);

      const { nonce } = await service.generateNonce(userId, deviceId);

      expect(nonce).to.be.a("string").with.length.greaterThan(20);
      expect(biometric.challenge).to.equal(nonce);
      expect(biometric.challengeExpiresAt!.getTime()).to.be.greaterThan(
        Date.now(),
      );
    });

    it("answers the same way for an unknown device without storing", async () => {
      const { nonce } = await service.generateNonce(userId, "unknown");

      expect(nonce).to.be.a("string").with.length.greaterThan(20);
      expect(biometricRepo.save.called).to.be.false;
    });
  });

  describe("verifyBiometricSignature", () => {
    it("opens a session for a valid signature over the nonce", async () => {
      const biometric = makeBiometric();

      biometricRepo.findByUserIdAndDeviceId.resolves(biometric);

      const result = await service.verifyBiometricSignature(
        { userId, deviceId, nonce: "nonce-1", signature: sign("nonce-1") },
        { ip: "10.0.0.1" },
      );

      expect(result.verified).to.be.true;
      expect(result.tokens.accessToken).to.equal("at");
      expect(biometricRepo.consumeChallenge.calledOnceWith("bio-1", "nonce-1"))
        .to.be.true;

      const [, deviceInfo, method] = authService.completeLogin.firstCall.args;

      expect(method).to.equal("biometric");
      expect(deviceInfo.ip).to.equal("10.0.0.1");
      expect(deviceInfo.deviceName).to.equal("iPhone");
    });

    it("rejects an unknown device with 401", async () => {
      const err = await expectRejected(
        service.verifyBiometricSignature({
          userId,
          deviceId,
          nonce: "nonce-1",
          signature: sign("nonce-1"),
        }),
      );

      expect(err).to.include({ status: 401, code: "BIOMETRIC_VERIFY_FAILED" });
    });

    it("rejects a nonce that does not match the stored one", async () => {
      biometricRepo.findByUserIdAndDeviceId.resolves(makeBiometric());

      const err = await expectRejected(
        service.verifyBiometricSignature({
          userId,
          deviceId,
          nonce: "other",
          signature: sign("other"),
        }),
      );

      expect(err).to.include({ status: 401, code: "BIOMETRIC_VERIFY_FAILED" });
      expect(authService.completeLogin.called).to.be.false;
    });

    it("rejects an expired nonce", async () => {
      biometricRepo.findByUserIdAndDeviceId.resolves(
        makeBiometric({ challengeExpiresAt: new Date(Date.now() - 1_000) }),
      );

      const err = await expectRejected(
        service.verifyBiometricSignature({
          userId,
          deviceId,
          nonce: "nonce-1",
          signature: sign("nonce-1"),
        }),
      );

      expect(err).to.include({ status: 401, code: "BIOMETRIC_VERIFY_FAILED" });
    });

    it("accepts a nonce only once", async () => {
      biometricRepo.findByUserIdAndDeviceId.resolves(makeBiometric());
      biometricRepo.consumeChallenge.onSecondCall().resolves(false);

      const payload = {
        userId,
        deviceId,
        nonce: "nonce-1",
        signature: sign("nonce-1"),
      };

      await service.verifyBiometricSignature(payload);
      const err = await expectRejected(
        service.verifyBiometricSignature(payload),
      );

      expect(err).to.include({ status: 401, code: "BIOMETRIC_VERIFY_FAILED" });
      expect(authService.completeLogin.calledOnce).to.be.true;
    });

    it("rejects an invalid signature and burns the nonce", async () => {
      biometricRepo.findByUserIdAndDeviceId.resolves(makeBiometric());

      const err = await expectRejected(
        service.verifyBiometricSignature({
          userId,
          deviceId,
          nonce: "nonce-1",
          signature: sign("something-else"),
        }),
      );

      expect(err).to.include({ status: 401, code: "BIOMETRIC_VERIFY_FAILED" });
      expect(biometricRepo.consumeChallenge.calledOnce).to.be.true;
      expect(authService.completeLogin.called).to.be.false;
    });
  });

  describe("getDevices", () => {
    it("returns devices of the user", async () => {
      biometricRepo.findByUserId.resolves([makeBiometric()]);

      expect(await service.getDevices(userId)).to.have.length(1);
    });
  });

  describe("deleteDevice", () => {
    it("deletes the device", async () => {
      await service.deleteDevice(userId, deviceId);

      expect(
        biometricRepo.deleteByUserIdAndDeviceId.calledOnceWith(
          userId,
          deviceId,
        ),
      ).to.be.true;
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        BiometricRemovedEvent,
      );
    });

    it("throws 404 when the device is missing", async () => {
      biometricRepo.deleteByUserIdAndDeviceId.resolves({ affected: 0 });

      const err = await expectRejected(service.deleteDevice(userId, deviceId));

      expect(err).to.include({
        status: 404,
        code: "BIOMETRIC_DEVICE_NOT_FOUND",
      });
    });
  });
});
