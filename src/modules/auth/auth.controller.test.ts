import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { config } from "../../config";
import { AuthController } from "./auth.controller";
import { AuthError } from "./auth.errors";
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from "./refresh-cookie";

const tokens = {
  accessToken: "at",
  refreshToken: "rt",
  expiresIn: 900,
  sessionId: "s1",
};

const makeReq = (cookies: Record<string, string> = {}) => {
  const set = sinon.stub();
  const cookieSet = sinon.stub();

  return {
    set,
    cookieSet,
    req: {
      ctx: {
        set,
        cookies: { set: cookieSet, get: (name: string) => cookies[name] },
        request: { headers: {}, ip: "127.0.0.1", user: undefined },
      },
    } as any,
  };
};

describe("AuthController", () => {
  let service: Record<string, sinon.SinonStub>;
  let controller: AuthController;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = {
      signIn: sandbox.stub().resolves({ id: "u1", tokens }),
      updateTokens: sandbox.stub().resolves(tokens),
      signOut: sandbox.stub().resolves(),
    };
    controller = new AuthController(service as any);
  });

  afterEach(() => sandbox.restore());

  it("sets Retry-After when the account is locked", async () => {
    service.signIn.rejects(AuthError.ACCOUNT_LOCKED({ retryAfter: 900 }));

    const { req, set } = makeReq();
    const err = await controller
      .signIn(req, { login: "a@b.c", password: "x" })
      .catch(e => e);

    expect(err).to.include({ status: 429, code: "AUTH_ACCOUNT_LOCKED" });
    expect(set.calledOnceWith("Retry-After", "900")).to.be.true;
  });

  it("does not set Retry-After for other errors", async () => {
    service.signIn.rejects(AuthError.INVALID_CREDENTIALS());

    const { req, set } = makeReq();

    await controller
      .signIn(req, { login: "a@b.c", password: "x" })
      .catch(() => {});

    expect(set.called).to.be.false;
  });

  describe("refresh cookie", () => {
    beforeEach(() => {
      sandbox.stub(config.auth.jwt, "refreshCookie").value(true);
    });

    it("sign-in puts the refresh token into an httpOnly cookie", async () => {
      const { req, cookieSet } = makeReq();

      await controller.signIn(req, { login: "a@b.c", password: "x" });

      const [name, value, options] = cookieSet.firstCall.args;

      expect(name).to.equal(REFRESH_COOKIE);
      expect(value).to.equal("rt");
      expect(options).to.include({
        httpOnly: true,
        sameSite: "strict",
        path: REFRESH_COOKIE_PATH,
      });
    });

    it("refresh reads the token from the cookie when the body has none", async () => {
      const { req } = makeReq({ [REFRESH_COOKIE]: "cookie-rt" });

      await controller.refresh(req, {});

      expect(service.updateTokens.calledOnceWith("cookie-rt")).to.be.true;
    });

    it("refresh prefers the body token", async () => {
      const { req } = makeReq({ [REFRESH_COOKIE]: "cookie-rt" });

      await controller.refresh(req, { refreshToken: "body-rt" });

      expect(service.updateTokens.calledOnceWith("body-rt")).to.be.true;
    });

    it("sign-out clears the cookie", async () => {
      const { req, cookieSet } = makeReq();

      req.ctx.request.user = {
        userId: "u1",
        sessionId: "s1",
        roles: [],
        permissions: [],
        emailVerified: true,
      };

      await controller.signOut(req);

      expect(service.signOut.calledOnce).to.be.true;
      expect(cookieSet.firstCall.args.slice(0, 2)).to.deep.equal([
        REFRESH_COOKIE,
        null,
      ]);
    });
  });

  describe("without the cookie flag", () => {
    beforeEach(() => {
      sandbox.stub(config.auth.jwt, "refreshCookie").value(false);
    });

    it("neither sets nor reads the cookie", async () => {
      const { req, cookieSet } = makeReq({ [REFRESH_COOKIE]: "cookie-rt" });

      await controller.signIn(req, { login: "a@b.c", password: "x" });
      await controller.refresh(req, {});

      expect(cookieSet.called).to.be.false;
      expect(service.updateTokens.calledOnceWith(undefined)).to.be.true;
    });
  });
});
