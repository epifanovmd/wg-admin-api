import "reflect-metadata";

import { expect } from "chai";
import jwt from "jsonwebtoken";
import sinon from "sinon";

import { config } from "../../config";
import {
  SessionRevocationList,
  setSessionRevocations,
} from "./session-revocation";
import { SUPERUSER_ROLE } from "./superuser";
import { TokenService, TokenSubject } from "./token.service";

describe("TokenService", () => {
  let service: TokenService;
  let sandbox: sinon.SinonSandbox;
  const secretKey = config.auth.jwt.secretKey;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new TokenService();
  });

  afterEach(() => sandbox.restore());

  const makeUser = (overrides: Partial<TokenSubject> = {}): TokenSubject => ({
    id: "user-1",
    emailVerified: true,
    roles: ["user"],
    permissions: ["chat:view", "chat:manage", "user:view"],
    ...overrides,
  });

  describe("issue", () => {
    it("creates tokens with correct payload (roles, merged permissions, emailVerified)", async () => {
      const user = makeUser();
      const result = await service.issue(user, "session-1");

      expect(result).to.have.property("accessToken").that.is.a("string");
      expect(result).to.have.property("refreshToken").that.is.a("string");

      const decoded = jwt.verify(result.accessToken, secretKey) as any;

      expect(decoded.scope).to.equal("access");
      expect(decoded.iss).to.equal(config.app.name);
      expect(decoded.aud).to.equal(config.app.name);
      expect(decoded.userId).to.equal("user-1");
      expect(decoded.roles).to.deep.equal(["user"]);
      expect(decoded.permissions).to.include.members([
        "chat:view",
        "chat:manage",
        "user:view",
      ]);
      expect(decoded.emailVerified).to.be.true;
    });

    it("reports access lifetime and session like OAuth expires_in", async () => {
      const result = await service.issue(makeUser(), "session-1");
      const decoded = jwt.decode(result.accessToken) as {
        exp: number;
        iat: number;
      };

      expect(result.expiresIn).to.equal(decoded.exp - decoded.iat);
      expect(result.expiresIn).to.be.greaterThan(0);
      expect(result.sessionId).to.equal("session-1");
      expect(result.refreshExpiresAt.getTime()).to.be.greaterThan(Date.now());
    });

    it("never issues the same refresh token twice for a session", async () => {
      const [a, b] = await Promise.all([
        service.issue(makeUser(), "session-1"),
        service.issue(makeUser(), "session-1"),
      ]);

      expect(a.refreshToken).to.not.equal(b.refreshToken);
    });

    it("deduplicates permissions", async () => {
      const result = await service.issue(
        makeUser({ permissions: ["user:view", "user:view"] }),
        "session-1",
      );
      const decoded = jwt.verify(result.accessToken, secretKey) as any;

      expect(decoded.permissions).to.deep.equal(["user:view"]);
    });

    it("handles empty roles and permissions", async () => {
      const result = await service.issue(
        makeUser({ roles: [], permissions: [] }),
        "session-1",
      );
      const decoded = jwt.verify(result.accessToken, secretKey) as any;

      expect(decoded.roles).to.deep.equal([]);
      expect(decoded.permissions).to.deep.equal([]);
    });
  });

  describe("verify", () => {
    const signOptions = {
      algorithm: "HS256" as const,
      issuer: config.app.name,
      audience: config.app.name,
    };
    const createToken = (payload: Record<string, any>) =>
      jwt.sign(
        { scope: "access", sessionId: "session-1", ...payload },
        secretKey,
        signOptions,
      );

    it("rejects a 2FA token used as Bearer", async () => {
      const token = await service.issueTwoFactor("user-1");

      try {
        await service.verify(token);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("rejects a refresh token used as Bearer", async () => {
      const { refreshToken } = await service.issue(makeUser(), "session-1");

      try {
        await service.verify(refreshToken);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("rejects an opaque (non-JWT) reset token used as Bearer", async () => {
      try {
        await service.verify("Zm9vYmFyYmF6cXV4cmFuZG9tYnl0ZXM");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("rejects a token signed without scope, issuer or audience", async () => {
      const token = jwt.sign(
        { userId: "user-1", sessionId: "session-1" },
        secretKey,
      );

      try {
        await service.verify(token);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("rejects an access token that is not bound to a session", async () => {
      const token = jwt.sign(
        { scope: "access", userId: "user-1", roles: [], permissions: [] },
        secretKey,
        signOptions,
      );

      try {
        await service.verify(token);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("accepts the access token it issued", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-1");
      const result = await service.verify(accessToken);

      expect(result.sessionId).to.equal("session-1");
    });

    it("valid token returns AuthContext", async () => {
      const token = createToken({
        userId: "user-1",
        roles: ["user"],
        permissions: ["chat:view"],
        emailVerified: true,
      });

      const result = await service.verify(token);

      expect(result.userId).to.equal("user-1");
      expect(result.roles).to.deep.equal(["user"]);
      expect(result.permissions).to.deep.equal(["chat:view"]);
      expect(result.emailVerified).to.be.true;
    });

    it("no token throws UnauthorizedException", async () => {
      try {
        await service.verify(undefined);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("invalid token throws UnauthorizedException", async () => {
      try {
        await service.verify("invalid.token.here");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });

    it("with scopes, user has required role - passes", async () => {
      const token = createToken({
        userId: "user-1",
        roles: ["user"],
        permissions: [],
        emailVerified: true,
      });

      const result = await service.verify(token, ["role:user"]);

      expect(result.userId).to.equal("user-1");
    });

    it("with scopes, user missing role throws ForbiddenException", async () => {
      const token = createToken({
        userId: "user-1",
        roles: ["guest"],
        permissions: [],
        emailVerified: true,
      });

      try {
        await service.verify(token, ["role:user"]);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 403 });
      }
    });

    it("admin role bypasses all scope checks", async () => {
      const token = createToken({
        userId: "admin-1",
        roles: [SUPERUSER_ROLE],
        permissions: [],
        emailVerified: true,
      });

      const result = await service.verify(token, [
        "role:user",
        "permission:chat:manage",
      ]);

      expect(result.userId).to.equal("admin-1");
    });

    it("* permission bypasses all scope checks", async () => {
      const token = createToken({
        userId: "super-1",
        roles: ["user"],
        permissions: ["*"],
        emailVerified: true,
      });

      const result = await service.verify(token, [
        "role:admin",
        "permission:chat:manage",
      ]);

      expect(result.userId).to.equal("super-1");
    });

    it("permission wildcard chat:* matches permission:chat:view", async () => {
      const token = createToken({
        userId: "user-1",
        roles: ["user"],
        permissions: ["chat:*"],
        emailVerified: true,
      });

      const result = await service.verify(token, ["permission:chat:view"]);

      expect(result.userId).to.equal("user-1");
    });

    it("missing permission throws ForbiddenException", async () => {
      const token = createToken({
        userId: "user-1",
        roles: ["user"],
        permissions: ["chat:view"],
        emailVerified: true,
      });

      try {
        await service.verify(token, ["permission:user:manage"]);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 403 });
      }
    });

    it("empty scopes array skips scope checking", async () => {
      const token = createToken({
        userId: "user-1",
        roles: [],
        permissions: [],
        emailVerified: false,
      });

      const result = await service.verify(token, []);

      expect(result.userId).to.equal("user-1");
      expect(result.emailVerified).to.be.false;
    });
  });

  describe("revocation", () => {
    let revocations: SessionRevocationList;

    beforeEach(() => {
      revocations = new SessionRevocationList();
      setSessionRevocations(revocations);
    });

    afterEach(() => setSessionRevocations(undefined));

    it("rejects an access token of a revoked session at once", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-1");

      await service.verify(accessToken);
      await service.revokeSessions(["session-1"]);

      const err = await service.verify(accessToken).catch(e => e);

      expect(err).to.include({ status: 401, code: "AUTH_SESSION_REVOKED" });
    });

    it("keeps other sessions working", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-2");

      await service.revokeSessions(["session-1"]);

      expect((await service.verify(accessToken)).sessionId).to.equal(
        "session-2",
      );
    });

    it("revokes every token of a deleted user", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-3");

      await service.revokeUser("user-1");

      const err = await service.verify(accessToken).catch(e => e);

      expect(err).to.include({ code: "AUTH_SESSION_REVOKED" });
    });

    it("rejects tokens issued before a privileges change with AUTH_PRIVILEGES_CHANGED", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-4");

      await service.markPrivilegesChanged("user-1");

      const err = await service.verify(accessToken).catch(e => e);

      expect(err).to.include({ status: 401, code: "AUTH_PRIVILEGES_CHANGED" });

      await new Promise(resolve => setTimeout(resolve, 2));

      const { accessToken: fresh } = await service.issue(
        makeUser(),
        "session-4",
      );

      expect((await service.verify(fresh)).sessionId).to.equal("session-4");
    });

    it("verifyAccess returns the token expiry", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-1");
      const { context, expiresAt } = await service.verifyAccess(accessToken);

      expect(context.userId).to.equal("user-1");
      expect(expiresAt.getTime()).to.be.greaterThan(Date.now());
    });
  });

  describe("error codes", () => {
    it("marks an expired token with AUTH_TOKEN_EXPIRED", async () => {
      const token = jwt.sign(
        { scope: "access", userId: "u", sessionId: "s" },
        secretKey,
        {
          algorithm: "HS256",
          issuer: config.app.name,
          audience: config.app.name,
          expiresIn: -10,
        },
      );

      const err = await service.verify(token).catch(e => e);

      expect(err).to.include({ status: 401, code: "AUTH_TOKEN_EXPIRED" });
    });

    it("marks a missing permission with AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { accessToken } = await service.issue(
        makeUser({ roles: [], permissions: [] }),
        "session-1",
      );

      const err = await service
        .verify(accessToken, ["permission:audit:view"])
        .catch(e => e);

      expect(err).to.include({
        status: 403,
        code: "AUTH_INSUFFICIENT_PERMISSIONS",
      });
    });
  });

  describe("verifyRefresh", () => {
    it("returns session and expiry for an issued refresh token", async () => {
      const { refreshToken } = await service.issue(makeUser(), "session-1");
      const result = await service.verifyRefresh(refreshToken);

      expect(result.userId).to.equal("user-1");
      expect(result.sessionId).to.equal("session-1");
      expect(result.expiresAt.getTime()).to.be.greaterThan(Date.now());
    });

    it("rejects an access token used as refresh", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-1");

      try {
        await service.verifyRefresh(accessToken);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });
  });

  describe("verifyTwoFactor", () => {
    it("returns userId and jti for an issued 2FA token", async () => {
      const token = await service.issueTwoFactor("user-1");
      const result = await service.verifyTwoFactor(token);

      expect(result.userId).to.equal("user-1");
      expect(result.jti).to.be.a("string").with.length.greaterThan(0);
    });

    it("issues a distinct jti per token", async () => {
      const [a, b] = await Promise.all([
        service.issueTwoFactor("user-1"),
        service.issueTwoFactor("user-1"),
      ]);

      expect((await service.verifyTwoFactor(a)).jti).to.not.equal(
        (await service.verifyTwoFactor(b)).jti,
      );
    });

    it("rejects an access token used as 2FA token", async () => {
      const { accessToken } = await service.issue(makeUser(), "session-1");

      try {
        await service.verifyTwoFactor(accessToken);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.include({ status: 401 });
      }
    });
  });
});
