import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { NotFoundException } from "../../core/http";
import {
  createMockEventBus,
  createMockRepository,
  uuid,
} from "../../test/helpers";
import { PasskeyRemovedEvent } from "./events";
import { PasskeysService } from "./passkeys.service";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("PasskeysService", () => {
  let service: PasskeysService;
  let userService: Record<string, sinon.SinonStub>;
  let passkeysRepo: ReturnType<typeof createMockRepository> &
    Record<string, sinon.SinonStub>;
  let challengeRepo: Record<string, sinon.SinonStub>;
  let authService: Record<string, sinon.SinonStub>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  const userId = uuid();
  const passkeyId = "credential-id-123";

  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    id: userId,
    email: "test@example.com",
    phone: "+79991234567",
    ...overrides,
  });

  const makePasskey = (overrides: Record<string, unknown> = {}) => ({
    id: passkeyId,
    userId,
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 0,
    deviceType: "singleDevice",
    transports: ["internal"],
    lastUsed: null,
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    passkeysRepo = createMockRepository() as any;
    passkeysRepo.findById = sinon.stub().resolves(null);
    passkeysRepo.findByUserId = sinon.stub().resolves([]);
    passkeysRepo.findPageByUserId = sinon.stub().resolves([[], 0]);

    userService = {
      getUser: sinon.stub().resolves(makeUser()),
      getUserByAttr: sinon.stub().resolves(makeUser()),
    };
    authService = {
      completeLogin: sinon.stub().resolves({
        id: userId,
        tokens: { accessToken: "at", refreshToken: "rt" },
      }),
    };
    eventBus = createMockEventBus();
    challengeRepo = {
      createChallenge: sinon.stub().resolves({ challenge: "test-challenge" }),
      consumeChallenge: sinon.stub().resolves(true),
      deleteByUserId: sinon.stub().resolves(),
      deleteExpired: sinon.stub().resolves(0),
    };

    service = new PasskeysService(
      userService as any,
      passkeysRepo as any,
      challengeRepo as any,
      authService as any,
      eventBus as any,
    );
  });

  describe("getPasskeys", () => {
    it("lists a page of passkeys of the user without public keys", async () => {
      passkeysRepo.findPageByUserId.resolves([[makePasskey()], 3]);

      const result = await service.getPasskeys(userId, 2, 1);

      expect(
        passkeysRepo.findPageByUserId.calledOnceWith(userId, {
          offset: 2,
          limit: 1,
        }),
      ).to.be.true;
      expect(result.total).to.equal(3);
      expect(result.items).to.have.length(1);
      expect(result.items[0].id).to.equal(passkeyId);
      expect(result.items[0]).to.not.have.property("publicKey");
      expect(result.items[0]).to.not.have.property("counter");
    });
  });

  describe("deletePasskey", () => {
    it("deletes only the owner's passkey", async () => {
      await service.deletePasskey(userId, passkeyId);

      expect(passkeysRepo.delete.calledOnceWith({ id: passkeyId, userId })).to
        .be.true;

      const [event] = eventBus.emit.firstCall.args;

      expect(event).to.be.instanceOf(PasskeyRemovedEvent);
      expect(event.passkeyId).to.equal(passkeyId);
    });

    it("throws 404 for a missing or foreign passkey", async () => {
      passkeysRepo.delete.resolves({ affected: 0 });

      const err = await expectRejected(
        service.deletePasskey(userId, passkeyId),
      );

      expect(err).to.include({ status: 404, code: "PASSKEY_NOT_FOUND" });
      expect(eventBus.emit.called).to.be.false;
    });
  });

  describe("generateRegistrationOptions", () => {
    it("rejects a user without email and phone with 400", async () => {
      userService.getUser.resolves(makeUser({ email: null, phone: null }));

      const err = await expectRejected(
        service.generateRegistrationOptions(userId),
      );

      expect(err).to.include({ status: 400 });
    });
  });

  describe("verifyRegistration", () => {
    it("rejects without a valid challenge with 400", async () => {
      challengeRepo.consumeChallenge.resolves(false);

      const err = await expectRejected(
        service.verifyRegistration(userId, {} as any),
      );

      expect(err).to.include({ status: 400 });
    });

    it("maps a verification error to 400", async () => {
      const err = await expectRejected(
        service.verifyRegistration(userId, {} as any),
      );

      expect(err).to.include({ status: 400 });
    });

    it("rejects an already registered credential with 409", async () => {
      passkeysRepo.findById.resolves(makePasskey());

      const err = await expectRejected(
        service.verifyRegistration(userId, { id: passkeyId } as any),
      );

      expect(err).to.include({
        status: 409,
        code: "PASSKEY_ALREADY_REGISTERED",
      });
    });
  });

  describe("generateAuthenticationOptions", () => {
    it("неизвестный логин — 200 с фиктивным ключом, без записи challenge", async () => {
      userService.getUserByAttr.rejects(new NotFoundException("nope"));

      const a = await service.generateAuthenticationOptions("unknown@test.com");
      const b = await service.generateAuthenticationOptions("unknown@test.com");

      expect(a.allowCredentials).to.have.length(1);
      expect(a.allowCredentials?.[0].id).to.equal(b.allowCredentials?.[0].id);
      expect(challengeRepo.createChallenge.called).to.be.false;
    });

    it("normalizes a phone login", async () => {
      passkeysRepo.findByUserId.resolves([]);

      await service.generateAuthenticationOptions("8 999 123 45 67");

      expect(userService.getUserByAttr.firstCall.args[0]).to.deep.equal({
        phone: "+79991234567",
      });
    });

    it("пользователь без passkey неотличим от несуществующего", async () => {
      const options =
        await service.generateAuthenticationOptions("test@example.com");

      expect(options.allowCredentials).to.have.length(1);
      expect(challengeRepo.createChallenge.called).to.be.false;
    });

    it("re-throws unexpected errors", async () => {
      const error = new Error("DB connection lost");

      userService.getUserByAttr.rejects(error);

      expect(
        await expectRejected(
          service.generateAuthenticationOptions("test@example.com"),
        ),
      ).to.equal(error);
    });
  });

  describe("verifyAuthentication", () => {
    it("rejects an unknown credential with 401 without echoing its id", async () => {
      const err = await expectRejected(
        service.verifyAuthentication({ id: "secret-credential-id" } as any),
      );

      expect(err).to.include({ status: 401, code: "PASSKEY_AUTH_FAILED" });
      expect((err as Error).message).to.not.include("secret-credential-id");
    });

    it("rejects without a valid challenge with 401", async () => {
      passkeysRepo.findById.resolves(makePasskey());
      challengeRepo.consumeChallenge.resolves(false);

      const err = await expectRejected(
        service.verifyAuthentication({ id: passkeyId } as any),
      );

      expect(err).to.include({ status: 401, code: "PASSKEY_AUTH_FAILED" });
    });

    it("maps a verification error to 401", async () => {
      passkeysRepo.findById.resolves(makePasskey());

      const err = await expectRejected(
        service.verifyAuthentication({ id: passkeyId } as any),
      );

      expect(err).to.include({ status: 401, code: "PASSKEY_AUTH_FAILED" });
      expect(authService.completeLogin.called).to.be.false;
    });
  });

  describe("cleanupExpiredChallenges", () => {
    it("delegates to the repository", async () => {
      challengeRepo.deleteExpired.resolves(4);

      expect(await service.cleanupExpiredChallenges()).to.equal(4);
    });
  });
});
