import "reflect-metadata";

import { expect } from "chai";
import { randomBytes } from "crypto";

import { iocContainer } from "../../app.container";
import { JwtSecurityScheme } from "./jwt.scheme";
import { koaAuthentication, resetSecuritySchemes } from "./koa-authentication";
import { SECURITY_SCHEME } from "./security-scheme";
import { TokenService } from "./token.service";

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  return expect.fail("should have thrown");
};

const makeRequest = (headers: Record<string, string>) =>
  ({ headers, ctx: { state: {} } }) as any;

describe("koaAuthentication", () => {
  const tokenService = new TokenService();

  before(() => {
    iocContainer.snapshot();
    iocContainer
      .bind(SECURITY_SCHEME)
      .toConstantValue(new JwtSecurityScheme(tokenService));
    resetSecuritySchemes();
  });

  after(() => {
    iocContainer.restore();
    resetSecuritySchemes();
  });

  describe("jwt", () => {
    it("accepts an access token", async () => {
      const { accessToken } = await tokenService.issue(
        { id: "user-1", roles: [], permissions: [], emailVerified: false },
        "session-1",
      );
      const request = makeRequest({ authorization: `Bearer ${accessToken}` });

      const user = await koaAuthentication(request, "jwt");

      expect(user?.userId).to.equal("user-1");
      expect(request.ctx.state.user).to.equal(user);
    });

    it("rejects a 2FA token as Bearer with 401", async () => {
      const token = await tokenService.issueTwoFactor("user-1");

      const err = await expectRejected(
        koaAuthentication(
          makeRequest({ authorization: `Bearer ${token}` }),
          "jwt",
        ),
      );

      expect(err).to.include({ status: 401 });
    });

    it("rejects a reset-password token as Bearer with 401", async () => {
      const resetToken = randomBytes(32).toString("base64url");

      const err = await expectRejected(
        koaAuthentication(
          makeRequest({ authorization: `Bearer ${resetToken}` }),
          "jwt",
        ),
      );

      expect(err).to.include({ status: 401 });
    });

    it("rejects a refresh token as Bearer with 401", async () => {
      const { refreshToken } = await tokenService.issue(
        { id: "user-1", roles: [], permissions: [], emailVerified: false },
        "session-1",
      );

      const err = await expectRejected(
        koaAuthentication(
          makeRequest({ authorization: `Bearer ${refreshToken}` }),
          "jwt",
        ),
      );

      expect(err).to.include({ status: 401 });
    });
  });

  describe("реестр схем", () => {
    it("неизвестная схема — 500 (ошибка конфигурации, не клиента)", async () => {
      const err = await expectRejected(
        koaAuthentication(makeRequest({}), "unknown"),
      );

      expect((err as { status?: number }).status).to.equal(500);
    });
  });
});
