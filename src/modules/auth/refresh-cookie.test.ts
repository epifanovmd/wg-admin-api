import { expect } from "chai";
import { IncomingMessage, ServerResponse } from "http";
import Koa from "koa";
import { Socket } from "net";
import sinon from "sinon";

import { config } from "../../config";
import { REFRESH_COOKIE, setRefreshCookie } from "./refresh-cookie";

/** Контекст Koa для запроса по «голому» HTTP — как за TLS-прокси без TRUST_PROXY. */
const plainHttpContext = () => {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);

  req.headers = { host: "api.example.com" };

  return new Koa().createContext(req, res);
};

describe("refresh-cookie", () => {
  afterEach(() => sinon.restore());

  it("Secure-cookie по HTTP за прокси без TRUST_PROXY не роняет вход", () => {
    sinon.stub(config.auth.jwt, "refreshCookie").value(true);
    const ctx = plainHttpContext();

    expect(() =>
      setRefreshCookie(ctx, { refreshToken: "r", accessToken: "a" } as any, {
        secure: true,
      }),
    ).not.to.throw();

    const header = String(ctx.response.get("Set-Cookie"));

    expect(header).to.include(`${REFRESH_COOKIE}=r`);
    expect(header.toLowerCase()).to.include("secure");
    expect(header.toLowerCase()).to.include("httponly");
  });
});
