import "reflect-metadata";

import bcrypt from "bcrypt";
import { expect } from "chai";
import sinon from "sinon";
import { QueryFailedError } from "typeorm";

import { logger, TokenService } from "../../core";
import { NotFoundException, UnauthorizedException } from "../../core/http";
import { createMockEventBus, uuid } from "../../test/helpers";
import { PasswordChangedEvent } from "../user";
import { LOGIN_MAX_FAILURES } from "./account-lockout";
import { AuthService, TWO_FACTOR_MAX_FAILURES } from "./auth.service";
import { MemoryAttemptsStore } from "./auth-attempts.store";
import {
  AccountLockedEvent,
  LoginFailedEvent,
  UserLoggedInEvent,
  UserSignedOutEvent,
} from "./events";

const STRONG_PASSWORD = "Correct-Horse-42";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("AuthService", () => {
  let service: AuthService;
  let userService: Record<string, sinon.SinonStub>;
  let mailerService: Record<string, sinon.SinonStub>;
  let resetTokens: Record<string, sinon.SinonStub>;
  let tokenService: TokenService & {
    issue: sinon.SinonStub;
    revokeSessions: sinon.SinonStub;
  };
  let eventBus: ReturnType<typeof createMockEventBus>;
  let sessionService: Record<string, sinon.SinonStub>;
  let attempts: MemoryAttemptsStore;
  let sandbox: sinon.SinonSandbox;

  let passwordHash: string;
  let twoFactorHash: string;

  before(async () => {
    passwordHash = await bcrypt.hash("password123", 4);
    twoFactorHash = await bcrypt.hash("2fa-password", 4);
  });

  const makeUser = (overrides: Record<string, any> = {}) => ({
    id: uuid(),
    email: "test@example.com",
    phone: "+71234567890",
    username: null,
    passwordHash,
    emailVerified: false,
    twoFactorHash: null,
    twoFactorHint: null,
    roles: [{ name: "USER", permissions: [], toDTO: () => ({ name: "USER" }) }],
    directPermissions: [],
    profile: { firstName: "Test", lastName: "User" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const subjectOf = (user: { id: string }) => ({
    id: user.id,
    roles: [],
    permissions: [],
    emailVerified: false,
  });

  const tokens = {
    accessToken: "access-token-123",
    refreshToken: "refresh-token-456",
    expiresIn: 900,
    sessionId: "session-123",
  };

  const notFound = () => new NotFoundException("Пользователь не найден");

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    userService = {
      getUserByAttr: sandbox.stub().rejects(notFound()),
      getUser: sandbox.stub(),
      createUser: sandbox.stub().resolves(),
      changePassword: sandbox.stub().resolves(),
      update2FA: sandbox.stub().resolves(),
      toUserDto: sandbox
        .stub()
        .callsFake(async (user: any) => ({ id: user.id, signed: true })),
    };
    mailerService = { sendResetPasswordMail: sandbox.stub().resolves() };
    resetTokens = {
      create: sandbox.stub().resolves({ token: "opaque" }),
      peek: sandbox.stub(),
      check: sandbox.stub(),
    };

    // Настоящие подпись и проверка 2FA/refresh; выдача пары — заглушка
    tokenService = Object.assign(new TokenService(), {
      issue: sandbox.stub().resolves({
        ...tokens,
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
      }),
      revokeSessions: sandbox.stub().resolves(),
    });

    eventBus = createMockEventBus();
    sessionService = {
      createAuthenticatedSession: sandbox
        .stub()
        .resolves({ sessionId: "session-123", tokens, session: {} }),
      validateRefresh: sandbox.stub(),
      rotateRefreshToken: sandbox.stub().resolves(tokens),
      terminateSession: sandbox.stub().resolves(),
      terminateAllByUser: sandbox.stub().resolves(),
    };
    attempts = new MemoryAttemptsStore();

    service = new AuthService(
      userService as any,
      mailerService as any,
      resetTokens as any,
      tokenService,
      eventBus as any,
      sessionService as any,
      attempts,
    );
  });

  afterEach(() => sandbox.restore());

  describe("signUp", () => {
    it("creates the user and signs in", async () => {
      const user = makeUser();

      userService.getUserByAttr.onFirstCall().rejects(notFound());
      userService.getUserByAttr.onSecondCall().resolves(user);

      const result = await service.signUp({
        email: "Test@Example.com",
        password: STRONG_PASSWORD,
      });

      const created = userService.createUser.firstCall.args[0];

      expect(created.email).to.equal("test@example.com");
      expect(created.passwordHash).to.match(/^scrypt\$/);
      expect(result).to.have.property("tokens");
    });

    it("checks both email and phone for uniqueness", async () => {
      userService.getUserByAttr.resolves(makeUser());

      const err = await expectRejected(
        service.signUp({
          email: "new@example.com",
          phone: "+71234567890",
          password: STRONG_PASSWORD,
        }),
      );

      expect(err).to.include({ status: 409, code: "AUTH_USER_EXISTS" });
      expect(userService.getUserByAttr.firstCall.args[0]).to.deep.equal({
        email: "new@example.com",
        phone: "+71234567890",
      });
      expect(userService.createUser.called).to.be.false;
    });

    it("maps a unique violation from a concurrent sign-up to 409", async () => {
      const driverError = Object.assign(new Error("duplicate key"), {
        code: "23505",
      });

      userService.createUser.rejects(
        new QueryFailedError("INSERT", [], driverError),
      );

      const err = await expectRejected(
        service.signUp({ email: "a@b.c", password: STRONG_PASSWORD }),
      );

      expect(err).to.include({ status: 409, code: "AUTH_USER_EXISTS" });
    });

    it("normalizes the phone before storing and signing in", async () => {
      userService.getUserByAttr.onSecondCall().resolves(makeUser());

      await service.signUp({
        phone: "8 (912) 345-67-89",
        password: STRONG_PASSWORD,
      });

      expect(userService.createUser.firstCall.args[0].phone).to.equal(
        "+79123456789",
      );
      expect(userService.getUserByAttr.secondCall.args[0]).to.deep.equal({
        phone: "+79123456789",
      });
    });

    it("requires email or phone", async () => {
      const err = await expectRejected(
        service.signUp({ password: STRONG_PASSWORD } as any),
      );

      expect(err).to.include({ status: 400 });
    });
  });

  describe("signIn", () => {
    it("returns the user with tokens on valid credentials", async () => {
      userService.getUserByAttr.resolves(makeUser());

      const result = await service.signIn({
        login: "test@example.com",
        password: "password123",
      });

      expect(result).to.have.property("tokens");
      // Пользователь собирается с подписанными ссылками (аватар), как в /user/my.
      expect(result).to.include({ signed: true });
      expect(sessionService.createAuthenticatedSession.calledOnce).to.be.true;
      expect(eventBus.emit.calledOnce).to.be.true;
    });

    it("rejects a wrong password with 401", async () => {
      userService.getUserByAttr.resolves(makeUser());

      const err = await expectRejected(
        service.signIn({ login: "test@example.com", password: "wrong" }),
      );

      expect(err).to.include({ status: 401 });
    });

    it("rejects an unknown login with 401", async () => {
      const err = await expectRejected(
        service.signIn({ login: "nobody@example.com", password: "whatever" }),
      );

      expect(err).to.include({ status: 401 });
    });

    it("normalizes a phone login", async () => {
      userService.getUserByAttr.resolves(makeUser());

      await service.signIn({
        login: "8 912 345 67 89",
        password: "password123",
      });

      expect(userService.getUserByAttr.firstCall.args[0]).to.deep.equal({
        phone: "+79123456789",
      });
    });

    it("does not swallow non-HTTP errors", async () => {
      userService.getUserByAttr.rejects(new Error("db down"));

      const err = await expectRejected(
        service.signIn({ login: "test@example.com", password: "password123" }),
      );

      expect(err).to.not.have.property("status");
      expect((err as Error).message).to.equal("db down");
    });

    it("returns a 2FA token that is not usable as access token", async () => {
      userService.getUserByAttr.resolves(
        makeUser({ twoFactorHash, twoFactorHint: "pet" }),
      );

      const result = (await service.signIn({
        login: "test@example.com",
        password: "password123",
      })) as any;

      expect(result.require2FA).to.be.true;
      expect(result.twoFactorHint).to.equal("pet");

      const err = await expectRejected(
        tokenService.verify(result.twoFactorToken),
      );

      expect(err).to.include({ status: 401 });
    });
  });

  describe("requestResetPassword", () => {
    const flush = () => new Promise(resolve => setImmediate(resolve));

    it("sends the mail in background in the user's language", async () => {
      const user = makeUser({
        profile: { firstName: "Test", lastName: "User", locale: "en" },
      });

      userService.getUserByAttr.resolves(user);

      const result = await service.requestResetPassword("test@example.com");

      await flush();

      expect(resetTokens.create.calledOnceWith(user.id)).to.be.true;
      expect(
        mailerService.sendResetPasswordMail.calledOnceWith(
          "test@example.com",
          "opaque",
          { locale: "en" },
        ),
      ).to.be.true;
      expect(result.message).to.include("Если пользователь");
    });

    it("answers the same for an unknown user", async () => {
      const known = await (async () => {
        userService.getUserByAttr.resolves(makeUser());

        return service.requestResetPassword("test@example.com");
      })();

      userService.getUserByAttr.rejects(notFound());
      const unknown = await service.requestResetPassword("x@example.com");

      expect(unknown).to.deep.equal(known);
    });

    it("logs a mail failure instead of failing the request", async () => {
      const logError = sandbox.stub(logger, "error");

      userService.getUserByAttr.resolves(makeUser());
      mailerService.sendResetPasswordMail.rejects(new Error("smtp down"));

      const result = await service.requestResetPassword("test@example.com");

      await flush();

      expect(result.message).to.include("Если пользователь");
      expect(logError.calledOnce).to.be.true;
    });

    it("skips the mail within the resend cooldown", async () => {
      userService.getUserByAttr.resolves(makeUser());
      resetTokens.create.resolves(null);

      await service.requestResetPassword("test@example.com");
      await flush();

      expect(mailerService.sendResetPasswordMail.called).to.be.false;
    });
  });

  describe("resetPassword", () => {
    it("changes the password, clears 2FA and emits a single reset event", async () => {
      const userId = uuid();

      resetTokens.peek.resolves({ userId });
      resetTokens.check.resolves({ userId });
      userService.getUser.resolves(makeUser({ id: userId }));

      await service.resetPassword("token", "newPassword123");

      expect(
        userService.changePassword.calledOnceWith(userId, "newPassword123"),
      ).to.be.true;
      expect(userService.update2FA.calledOnceWith(userId, null, null)).to.be
        .true;
      // Сессии завершает слушатель события; ответ ждёт его (emitAsync) —
      // старые сессии отозваны к моменту ответа.
      expect(eventBus.emitAsync.calledOnce).to.be.true;
      const [event] = eventBus.emitAsync.firstCall.args;

      expect(event).to.be.instanceOf(PasswordChangedEvent);
      expect(event.method).to.equal("reset");
      expect(event.currentSessionId).to.be.undefined;
    });
  });

  describe("updateTokens", () => {
    it("validates the session and rotates the refresh token", async () => {
      const user = makeUser();
      const { refreshToken } = await new TokenService().issue(
        subjectOf(user),
        "session-123",
      );
      const session = { id: "session-123", userId: user.id };

      sessionService.validateRefresh.resolves(session);
      userService.getUser.resolves(user);

      const result = await service.updateTokens(refreshToken);

      const [decoded, token] = sessionService.validateRefresh.firstCall.args;

      expect(decoded.sessionId).to.equal("session-123");
      expect(token).to.equal(refreshToken);
      expect(sessionService.rotateRefreshToken.firstCall.args[0]).to.equal(
        session,
      );
      expect(result).to.equal(tokens);
    });

    it("rejects an access token used as refresh", async () => {
      const { accessToken } = await new TokenService().issue(
        subjectOf(makeUser()),
        "session-123",
      );

      const err = await expectRejected(service.updateTokens(accessToken));

      expect(err).to.include({ status: 401 });
      expect(sessionService.validateRefresh.called).to.be.false;
    });

    it("rejects a missing token", async () => {
      const err = await expectRejected(service.updateTokens(undefined));

      expect(err).to.include({ status: 401 });
    });

    it("propagates reuse detection from the session", async () => {
      const { refreshToken } = await new TokenService().issue(
        subjectOf(makeUser()),
        "session-123",
      );

      sessionService.validateRefresh.rejects(new UnauthorizedException());

      const err = await expectRejected(service.updateTokens(refreshToken));

      expect(err).to.include({ status: 401 });
      expect(sessionService.rotateRefreshToken.called).to.be.false;
    });
  });

  describe("enable2FA", () => {
    it("enables 2FA with the right account password", async () => {
      const user = makeUser();

      userService.getUser.resolves(user);

      await service.enable2FA(user.id, "password123", "2fa-password", "hint");

      const [, hash, hint] = userService.update2FA.firstCall.args;

      expect(hash).to.match(/^scrypt\$/);
      expect(hint).to.equal("hint");
      expect(eventBus.emit.calledOnce).to.be.true;
    });

    it("rejects a wrong account password with 403", async () => {
      userService.getUser.resolves(makeUser());

      const err = await expectRejected(
        service.enable2FA(uuid(), "wrong", "2fa-password"),
      );

      expect(err).to.include({ status: 403 });
      expect(userService.update2FA.called).to.be.false;
    });

    it("rejects when 2FA is already enabled", async () => {
      userService.getUser.resolves(makeUser({ twoFactorHash }));

      const err = await expectRejected(
        service.enable2FA(uuid(), "password123", "2fa-password"),
      );

      expect(err).to.include({ status: 400 });
    });
  });

  describe("disable2FA", () => {
    it("disables 2FA with both passwords", async () => {
      userService.getUser.resolves(makeUser({ twoFactorHash }));

      await service.disable2FA(uuid(), "password123", "2fa-password");

      expect(userService.update2FA.calledOnceWith(uuid(), null, null)).to.be
        .true;
    });

    it("rejects a wrong account password with 403", async () => {
      userService.getUser.resolves(makeUser({ twoFactorHash }));

      const err = await expectRejected(
        service.disable2FA(uuid(), "wrong", "2fa-password"),
      );

      expect(err).to.include({ status: 403 });
    });

    it("rejects a wrong 2FA password with 403", async () => {
      userService.getUser.resolves(makeUser({ twoFactorHash }));

      const err = await expectRejected(
        service.disable2FA(uuid(), "password123", "wrong-2fa"),
      );

      expect(err).to.include({ status: 403 });
    });

    it("rejects when 2FA is not enabled", async () => {
      userService.getUser.resolves(makeUser());

      const err = await expectRejected(
        service.disable2FA(uuid(), "password123", "2fa-password"),
      );

      expect(err).to.include({ status: 400 });
    });
  });

  describe("verify2FA", () => {
    const user = () => makeUser({ twoFactorHash });

    it("returns tokens for the right 2FA password", async () => {
      userService.getUser.resolves(user());

      const token = await tokenService.issueTwoFactor(uuid());
      const result = await service.verify2FA(token, "2fa-password");

      expect(result).to.have.property("tokens");
    });

    it("accepts a 2FA token only once", async () => {
      userService.getUser.resolves(user());

      const token = await tokenService.issueTwoFactor(uuid());

      await service.verify2FA(token, "2fa-password");
      const err = await expectRejected(
        service.verify2FA(token, "2fa-password"),
      );

      expect(err).to.include({ status: 401 });
      expect(sessionService.createAuthenticatedSession.calledOnce).to.be.true;
    });

    it("rejects an access token in place of a 2FA token", async () => {
      const { accessToken } = await new TokenService().issue(
        subjectOf(makeUser()),
        "session-123",
      );

      const err = await expectRejected(
        service.verify2FA(accessToken, "2fa-password"),
      );

      expect(err).to.include({ status: 401 });
    });

    it("rejects a wrong 2FA password with 401", async () => {
      userService.getUser.resolves(user());

      const token = await tokenService.issueTwoFactor(uuid());
      const err = await expectRejected(service.verify2FA(token, "wrong-pass"));

      expect(err).to.include({ status: 401 });
    });

    it("locks the user after too many failures, even with a fresh token", async () => {
      userService.getUser.resolves(user());

      for (let i = 1; i < TWO_FACTOR_MAX_FAILURES; i += 1) {
        const token = await tokenService.issueTwoFactor(uuid());

        await expectRejected(service.verify2FA(token, "wrong-pass"));
      }

      const last = await expectRejected(
        service.verify2FA(
          await tokenService.issueTwoFactor(uuid()),
          "wrong-pass",
        ),
      );

      expect(last).to.include({ status: 429, code: "AUTH_TOO_MANY_ATTEMPTS" });

      const locked = await expectRejected(
        service.verify2FA(
          await tokenService.issueTwoFactor(uuid()),
          "2fa-password",
        ),
      );

      expect(locked).to.include({
        status: 429,
        code: "AUTH_TOO_MANY_ATTEMPTS",
      });
      expect(sessionService.createAuthenticatedSession.called).to.be.false;
    });

    it("resets the failure counter after a success", async () => {
      userService.getUser.resolves(user());

      await expectRejected(
        service.verify2FA(await tokenService.issueTwoFactor(uuid()), "wrong-1"),
      );
      await service.verify2FA(
        await tokenService.issueTwoFactor(uuid()),
        "2fa-password",
      );

      expect(await attempts.getFailures(`2fa:fail:${uuid()}`)).to.equal(0);
    });

    it("rejects when 2FA is not enabled", async () => {
      userService.getUser.resolves(makeUser());

      const err = await expectRejected(
        service.verify2FA(
          await tokenService.issueTwoFactor(uuid()),
          "2fa-password",
        ),
      );

      expect(err).to.include({ status: 400 });
    });
  });

  describe("password policy", () => {
    it("rejects a weak password on sign-up before touching users", async () => {
      const err = await expectRejected(
        service.signUp({ email: "a@b.c", password: "password123" }),
      );

      expect(err).to.include({ status: 400, code: "VALIDATION_ERROR" });
      expect(userService.createUser.called).to.be.false;
    });

    it("rejects a password equal to the email on sign-up", async () => {
      const err = await expectRejected(
        service.signUp({ email: "longname@b.c", password: "longname@b.c" }),
      );

      expect(err).to.include({ code: "VALIDATION_ERROR" });
    });

    it("rejects a weak reset password without consuming the token", async () => {
      resetTokens.peek.resolves({ userId: uuid() });
      userService.getUser.resolves(makeUser());

      const err = await expectRejected(
        service.resetPassword("token", "test@example.com"),
      );

      expect(err).to.include({ code: "VALIDATION_ERROR" });
      expect(resetTokens.check.called).to.be.false;
      expect(userService.changePassword.called).to.be.false;
    });
  });

  describe("account lockout", () => {
    const failOnce = () =>
      expectRejected(
        service.signIn(
          { login: "test@example.com", password: "wrong" },
          { ip: "10.0.0.1" },
        ),
      );

    beforeEach(() => userService.getUserByAttr.resolves(makeUser()));

    it("locks the account after too many failures with Retry-After details", async () => {
      for (let i = 1; i < LOGIN_MAX_FAILURES; i += 1) {
        expect(await failOnce()).to.include({
          code: "AUTH_INVALID_CREDENTIALS",
        });
      }

      const last = (await failOnce()) as { reason: { retryAfter: number } };

      expect(last).to.include({ status: 429, code: "AUTH_ACCOUNT_LOCKED" });
      expect(last.reason.retryAfter).to.equal(15 * 60);

      const lockedEvents = eventBus.emit.args
        .map(([event]) => event)
        .filter(event => event instanceof AccountLockedEvent);

      expect(lockedEvents).to.have.length(1);
      expect(lockedEvents[0].userId).to.equal(uuid());
      expect(lockedEvents[0].request.ip).to.equal("10.0.0.1");
    });

    it("keeps the account locked even with the right password", async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await failOnce();

      const err = await expectRejected(
        service.signIn({ login: "test@example.com", password: "password123" }),
      );

      expect(err).to.include({ status: 429, code: "AUTH_ACCOUNT_LOCKED" });
      expect(sessionService.createAuthenticatedSession.called).to.be.false;
    });

    it("resets the counter after a successful sign-in", async () => {
      for (let i = 1; i < LOGIN_MAX_FAILURES; i += 1) await failOnce();

      await service.signIn({
        login: "test@example.com",
        password: "password123",
      });

      expect(await failOnce()).to.include({ code: "AUTH_INVALID_CREDENTIALS" });
    });

    it("locks unknown logins the same way", async () => {
      userService.getUserByAttr.rejects(notFound());

      let last: unknown;

      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
        last = await expectRejected(
          service.signIn({ login: "ghost@example.com", password: "x" }),
        );
      }

      expect(last).to.include({ code: "AUTH_ACCOUNT_LOCKED" });
    });

    it("emits LoginFailedEvent with the attacked account", async () => {
      await failOnce();

      const [event] = eventBus.emit.firstCall.args;

      expect(event).to.be.instanceOf(LoginFailedEvent);
      expect(event.userId).to.equal(uuid());
      expect(event.reason).to.equal("invalid-credentials");
    });

    it("unlocks the account after a password reset", async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await failOnce();

      resetTokens.peek.resolves({ userId: uuid() });
      resetTokens.check.resolves({ userId: uuid() });
      userService.getUser.resolves(makeUser());
      await service.resetPassword("token", STRONG_PASSWORD);

      expect(await failOnce()).to.include({ code: "AUTH_INVALID_CREDENTIALS" });
    });
  });

  describe("login events", () => {
    it("passes a neutral token subject and emits the login method", async () => {
      userService.getUserByAttr.resolves(
        makeUser({
          roles: [
            {
              name: "user",
              permissions: [
                { name: "chat:view", toDTO: () => ({ name: "chat:view" }) },
              ],
              toDTO: () => ({ name: "user" }),
            },
          ],
          directPermissions: [
            { name: "chat:view", toDTO: () => ({ name: "chat:view" }) },
            { name: "user:view", toDTO: () => ({ name: "user:view" }) },
          ],
        }),
      );

      await service.signIn(
        { login: "test@example.com", password: "password123" },
        { ip: "1.2.3.4", userAgent: "UA" },
      );

      const [subject] =
        sessionService.createAuthenticatedSession.firstCall.args;

      expect(subject).to.deep.equal({
        id: uuid(),
        roles: ["user"],
        permissions: ["chat:view", "user:view"],
        emailVerified: false,
      });

      const [event] = eventBus.emit.firstCall.args;

      expect(event).to.be.instanceOf(UserLoggedInEvent);
      expect(event.method).to.equal("password");
      expect(event.request).to.deep.equal({ ip: "1.2.3.4", userAgent: "UA" });
    });

    it("completeLogin opens a session for another method", async () => {
      await service.completeLogin(makeUser() as any, {}, "passkey");

      expect(eventBus.emit.firstCall.args[0].method).to.equal("passkey");
    });
  });

  describe("signOut", () => {
    const caller = {
      userId: uuid(),
      sessionId: "session-123",
      roles: [],
      permissions: [],
      emailVerified: true,
    };

    it("terminates the current session and emits UserSignedOutEvent", async () => {
      await service.signOut(caller, { ip: "1.1.1.1" });

      expect(
        sessionService.terminateSession.calledOnceWith(
          "session-123",
          uuid(),
          "sign-out",
        ),
      ).to.be.true;

      const [event] = eventBus.emit.firstCall.args;

      expect(event).to.be.instanceOf(UserSignedOutEvent);
      expect(event.scope).to.equal("current");
    });

    it("treats an already terminated session as signed out", async () => {
      sessionService.terminateSession.rejects(notFound());

      await service.signOut(caller);

      expect(tokenService.revokeSessions.calledOnceWith(["session-123"])).to.be
        .true;
    });

    it("signOutAll terminates every session and revokes the current token", async () => {
      await service.signOutAll(caller);

      expect(
        sessionService.terminateAllByUser.calledOnceWith(
          uuid(),
          undefined,
          "sign-out-all",
        ),
      ).to.be.true;
      expect(tokenService.revokeSessions.calledOnceWith(["session-123"])).to.be
        .true;
      expect(eventBus.emit.firstCall.args[0].scope).to.equal("all");
    });
  });
});
