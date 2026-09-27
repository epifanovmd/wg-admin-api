import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  hashToken,
  JwtSecurityScheme,
  logger,
  SessionRevocationList,
  setSessionRevocations,
  TokenService,
} from "../../core";
import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
} from "../../test/helpers";
import { SessionTerminatedEvent } from "./events";
import { MAX_ACTIVE_SESSIONS, SessionService } from "./session.service";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

describe("SessionService", () => {
  let service: SessionService;
  let sessionRepo: ReturnType<typeof createMockRepository> &
    Record<string, any>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let tokenService: { issue: sinon.SinonStub; revokeSessions: sinon.SinonStub };

  const userId = uuid();
  const sessionId = uuid2();
  const refreshToken = "refresh-token-current";
  const refreshExpiresAt = new Date(Date.now() + 7 * 86_400_000);

  const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: sessionId,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiresAt,
    deviceName: "iPhone",
    deviceType: "mobile",
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0",
    lastActiveAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

  const issued = (token = "refresh-token-new") => ({
    accessToken: "access-token",
    refreshToken: token,
    expiresIn: 900,
    sessionId,
    refreshExpiresAt,
  });

  beforeEach(() => {
    sessionRepo = createMockRepository() as any;
    sessionRepo.findActiveByUserId = sinon.stub().resolves([[], 0]);
    sessionRepo.findById = sinon.stub().resolves(null);
    sessionRepo.rotateRefreshToken = sinon.stub().resolves(true);
    sessionRepo.findIdsBeyondLimit = sinon.stub().resolves([]);
    sessionRepo.deleteByIds = sinon.stub().resolves();
    sessionRepo.deleteExpired = sinon.stub().resolves(0);

    tokenService = {
      issue: sinon.stub().resolves(issued("refresh-a")),
      revokeSessions: sinon.stub().resolves(),
    };
    eventBus = createMockEventBus();

    service = new SessionService(
      sessionRepo as any,
      tokenService as any,
      eventBus as any,
    );
  });

  describe("createAuthenticatedSession", () => {
    it("stores only the refresh token hash and its expiry", async () => {
      sessionRepo.createAndSave.callsFake(async (data: any) => data);

      const result = await service.createAuthenticatedSession(
        { id: userId, roles: [], permissions: [], emailVerified: true },
        { deviceName: "iPhone", ip: "10.0.0.1" },
      );

      const saved = sessionRepo.createAndSave.firstCall.args[0];

      expect(saved.refreshTokenHash).to.equal(hashToken("refresh-a"));
      expect(saved).to.not.have.property("refreshToken");
      expect(saved.expiresAt).to.equal(refreshExpiresAt);
      expect(saved.deviceName).to.equal("iPhone");
      expect(saved.deviceType).to.be.null;
      expect(result.tokens.refreshToken).to.equal("refresh-a");
      expect(result.tokens).to.not.have.property("refreshExpiresAt");
    });

    it("terminates the oldest sessions beyond the limit", async () => {
      sessionRepo.findIdsBeyondLimit.resolves(["old-1", "old-2"]);

      await service.createAuthenticatedSession({
        id: userId,
        roles: [],
        permissions: [],
        emailVerified: true,
      });

      expect(
        sessionRepo.findIdsBeyondLimit.calledOnceWith(
          userId,
          MAX_ACTIVE_SESSIONS,
        ),
      ).to.be.true;
      expect(sessionRepo.deleteByIds.calledOnceWith(["old-1", "old-2"])).to.be
        .true;
      expect(eventBus.emit.callCount).to.equal(2);
      expect(eventBus.emit.firstCall.args[0]).to.be.instanceOf(
        SessionTerminatedEvent,
      );
    });
  });

  describe("validateRefresh", () => {
    const decoded = { userId, sessionId, expiresAt: refreshExpiresAt };

    it("returns the session for the current refresh token", async () => {
      sessionRepo.findById.resolves(makeSession());

      const session = await service.validateRefresh(decoded, refreshToken);

      expect(session.id).to.equal(sessionId);
      expect(sessionRepo.findById.calledOnceWith(sessionId)).to.be.true;
    });

    it("rejects when the session does not exist", async () => {
      const err = await expectRejected(
        service.validateRefresh(decoded, refreshToken),
      );

      expect(err).to.include({ status: 401 });
    });

    it("rejects a session of another user", async () => {
      sessionRepo.findById.resolves(makeSession({ userId: "someone-else" }));

      const err = await expectRejected(
        service.validateRefresh(decoded, refreshToken),
      );

      expect(err).to.include({ status: 401 });
    });

    it("reuse of a rotated token terminates the session", async () => {
      sessionRepo.findById.resolves(makeSession());

      const err = await expectRejected(
        service.validateRefresh(decoded, "refresh-token-rotated-away"),
      );

      expect(err).to.include({ status: 401 });
      expect(sessionRepo.deleteByIds.calledOnceWith([sessionId])).to.be.true;
      expect(eventBus.emit.calledOnce).to.be.true;
    });

    it("rejects and removes an expired session", async () => {
      sessionRepo.findById.resolves(
        makeSession({ expiresAt: new Date(Date.now() - 1_000) }),
      );

      const err = await expectRejected(
        service.validateRefresh(decoded, refreshToken),
      );

      expect(err).to.include({ status: 401 });
      expect(sessionRepo.deleteByIds.calledOnceWith([sessionId])).to.be.true;
    });
  });

  describe("rotateRefreshToken", () => {
    it("swaps hashes atomically and refreshes the expiry", async () => {
      const tokens = await service.rotateRefreshToken(
        makeSession() as any,
        refreshToken,
        issued(),
      );

      expect(
        sessionRepo.rotateRefreshToken.calledOnceWith(
          sessionId,
          hashToken(refreshToken),
          hashToken("refresh-token-new"),
          refreshExpiresAt,
        ),
      ).to.be.true;
      expect(tokens.refreshToken).to.equal("refresh-token-new");
    });

    it("a lost race means reuse: session terminated, 401", async () => {
      sessionRepo.rotateRefreshToken.resolves(false);

      const err = await expectRejected(
        service.rotateRefreshToken(
          makeSession() as any,
          refreshToken,
          issued(),
        ),
      );

      expect(err).to.include({ status: 401 });
      expect(sessionRepo.deleteByIds.calledOnceWith([sessionId])).to.be.true;
    });
  });

  describe("getSessions", () => {
    it("returns a page of active sessions of the user", async () => {
      sessionRepo.findActiveByUserId.resolves([
        [makeSession(), makeSession({ id: "session-2" })],
        7,
      ]);

      const result = await service.getSessions(userId, 5, 2);

      expect(
        sessionRepo.findActiveByUserId.calledOnceWith(userId, {
          offset: 5,
          limit: 2,
        }),
      ).to.be.true;
      expect(result.total).to.equal(7);
      expect(result.offset).to.equal(5);
      expect(result.limit).to.equal(2);
      expect(result.items).to.have.length(2);
      expect(result.items[0]).to.have.property("expiresAt");
      expect(result.items[0]).to.not.have.property("refreshTokenHash");
    });

    it("clamps the page size", async () => {
      await service.getSessions(userId, -1, 1_000);

      expect(sessionRepo.findActiveByUserId.firstCall.args[1]).to.deep.equal({
        offset: 0,
        limit: 100,
      });
    });
  });

  describe("terminateSession", () => {
    it("deletes the session and emits SessionTerminatedEvent", async () => {
      sessionRepo.findById.resolves(makeSession());

      await service.terminateSession(sessionId, userId);

      expect(sessionRepo.deleteByIds.calledOnceWith([sessionId])).to.be.true;
      const [event] = eventBus.emit.firstCall.args;

      expect(event).to.be.instanceOf(SessionTerminatedEvent);
      expect(event.sessionId).to.equal(sessionId);
      expect(event.reason).to.equal("terminated");
      expect(tokenService.revokeSessions.calledOnceWith([sessionId])).to.be
        .true;
    });

    it("passes the reason to the event", async () => {
      sessionRepo.findById.resolves(makeSession());

      await service.terminateSession(sessionId, userId, "sign-out");

      expect(eventBus.emit.firstCall.args[0].reason).to.equal("sign-out");
    });

    it("still emits the event when revocation fails", async () => {
      sessionRepo.findById.resolves(makeSession());
      tokenService.revokeSessions.rejects(new Error("redis down"));
      const logError = sinon.stub(logger, "error");

      try {
        await service.terminateSession(sessionId, userId);
      } finally {
        logError.restore();
      }

      expect(eventBus.emit.calledOnce).to.be.true;
      expect(logError.calledOnce).to.be.true;
    });

    it("throws NotFoundException when the session is missing", async () => {
      const err = await expectRejected(
        service.terminateSession(sessionId, userId),
      );

      expect(err).to.include({ status: 404, code: "SESSION_NOT_FOUND" });
    });

    it("throws ForbiddenException for a foreign session", async () => {
      sessionRepo.findById.resolves(makeSession({ userId: "other-user" }));

      const err = await expectRejected(
        service.terminateSession(sessionId, userId),
      );

      expect(err).to.include({ status: 403, code: "SESSION_FORBIDDEN" });
    });
  });

  describe("terminateAllByUser", () => {
    it("keeps the excepted session", async () => {
      sessionRepo.find.resolves([{ id: "s-1" }, { id: "s-2" }]);

      await service.terminateAllByUser(userId, "current");

      const { where } = sessionRepo.find.firstCall.args[0];

      expect(where.userId).to.equal(userId);
      expect(where.id).to.exist;
      expect(sessionRepo.deleteByIds.calledOnceWith(["s-1", "s-2"])).to.be.true;
      expect(eventBus.emit.callCount).to.equal(2);
    });

    it("terminates every session without an exception", async () => {
      sessionRepo.find.resolves([{ id: "s-1" }]);

      await service.terminateAllByUser(userId);

      expect(sessionRepo.find.firstCall.args[0].where).to.deep.equal({
        userId,
      });
    });
  });

  describe("cleanupExpired", () => {
    it("delegates to the repository", async () => {
      sessionRepo.deleteExpired.resolves(3);

      expect(await service.cleanupExpired()).to.equal(3);
    });
  });

  describe("with a real TokenService", () => {
    beforeEach(() => setSessionRevocations(new SessionRevocationList()));
    afterEach(() => setSessionRevocations(undefined));

    it("an access token of a terminated session gets 401 at once", async () => {
      const tokens = new TokenService();
      const scheme = new JwtSecurityScheme(tokens);
      const real = new SessionService(
        sessionRepo as any,
        tokens,
        eventBus as any,
      );

      sessionRepo.createAndSave.callsFake(async (data: any) => data);

      const { tokens: issuedTokens, sessionId: id } =
        await real.createAuthenticatedSession({
          id: userId,
          roles: [],
          permissions: [],
          emailVerified: true,
        });
      const request = {
        headers: { authorization: `Bearer ${issuedTokens.accessToken}` },
      } as any;

      expect((await scheme.authenticate(request, [])).sessionId).to.equal(id);

      sessionRepo.findById.resolves(makeSession({ id }));
      await real.terminateSession(id, userId, "sign-out");

      const err = await expectRejected(scheme.authenticate(request, []));

      expect(err).to.include({ status: 401, code: "AUTH_SESSION_REVOKED" });
    });
  });
});
