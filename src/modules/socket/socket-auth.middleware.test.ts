import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  SessionRevocationList,
  setSessionRevocations,
  TokenService,
  TokenSubject,
} from "../../core";
import {
  SOCKET_AUTH_GRACE_MS,
  SocketAuthMiddleware,
} from "./socket-auth.middleware";

const subject = (id = "user-1"): TokenSubject => ({
  id,
  roles: [],
  permissions: [],
  emailVerified: true,
});

describe("SocketAuthMiddleware", () => {
  const tokenService = new TokenService();
  const middleware = new SocketAuthMiddleware(tokenService);

  const makeSocket = (token?: string) =>
    ({ handshake: { auth: { token } }, data: undefined }) as any;

  it("accepts an access token", async () => {
    const { accessToken } = await tokenService.issue(subject(), "session-1");
    const socket = makeSocket(`Bearer ${accessToken}`);
    const next = sinon.stub();

    await middleware.handle(socket, next);

    expect(next.calledOnceWithExactly()).to.be.true;
    expect(socket.data.sessionId).to.equal("session-1");
  });

  it("rejects a 2FA token", async () => {
    const socket = makeSocket(await tokenService.issueTwoFactor("user-1"));
    const next = sinon.stub();

    await middleware.handle(socket, next);

    expect(next.firstCall.args[0]).to.be.instanceOf(Error);
    expect(socket.data).to.be.undefined;
  });

  it("rejects a refresh token", async () => {
    const { refreshToken } = await tokenService.issue(subject(), "session-1");
    const socket = makeSocket(refreshToken);
    const next = sinon.stub();

    await middleware.handle(socket, next);

    expect(next.firstCall.args[0]).to.be.instanceOf(Error);
  });

  describe("token lifetime", () => {
    let clock: sinon.SinonFakeTimers;
    let mw: SocketAuthMiddleware;
    let tokens: TokenService;

    /** Сокет с обработчиками событий и заглушками emit/disconnect. */
    const makeLiveSocket = (token: string) => {
      const handlers: Record<string, (...args: any[]) => unknown> = {};

      return {
        handshake: { auth: { token } },
        data: undefined as any,
        handlers,
        on: (event: string, handler: (...args: any[]) => unknown) => {
          handlers[event] = handler;
        },
        emit: sinon.stub(),
        disconnect: sinon.stub(),
      };
    };

    const connect = async (sessionId = "session-1") => {
      const { accessToken } = await tokens.issue(subject(), sessionId);
      const socket = makeLiveSocket(accessToken);

      await mw.handle(socket as any, sinon.stub());
      mw.watch(socket as any);

      return socket;
    };

    const ttlMs = () => 15 * 60_000;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ now: 1_700_000_000_000 });
      setSessionRevocations(new SessionRevocationList());
      tokens = new TokenService();
      mw = new SocketAuthMiddleware(tokens);
    });

    afterEach(() => {
      clock.restore();
      setSessionRevocations(undefined);
    });

    it("emits auth:expired at token expiry and disconnects after the grace period", async () => {
      const socket = await connect();

      await clock.tickAsync(ttlMs() + 1);

      expect(
        socket.emit.calledOnceWith("auth:expired", {
          graceMs: SOCKET_AUTH_GRACE_MS,
        }),
      ).to.be.true;
      expect(socket.disconnect.called).to.be.false;

      await clock.tickAsync(SOCKET_AUTH_GRACE_MS);

      expect(socket.disconnect.calledOnceWith(true)).to.be.true;
    });

    it("auth:refresh with a token of the same session extends the connection", async () => {
      const socket = await connect();

      await clock.tickAsync(ttlMs() + 1);

      const { accessToken } = await tokens.issue(subject(), "session-1");
      const ack = sinon.stub();

      await socket.handlers["auth:refresh"]({ accessToken }, ack);

      expect(ack.firstCall.args[0].ok).to.be.true;
      expect(ack.firstCall.args[0].expiresAt).to.be.a("string");

      await clock.tickAsync(SOCKET_AUTH_GRACE_MS + 1);

      expect(socket.disconnect.called).to.be.false;
    });

    it("auth:refresh rejects a token of another session", async () => {
      const socket = await connect();
      const { accessToken } = await tokens.issue(subject(), "session-2");
      const ack = sinon.stub();

      await socket.handlers["auth:refresh"]({ accessToken }, ack);

      expect(ack.firstCall.args[0].ok).to.be.false;
      expect(socket.data.sessionId).to.equal("session-1");
    });

    it("auth:refresh rejects a token of another user", async () => {
      const socket = await connect();
      const { accessToken } = await tokens.issue(
        subject("user-2"),
        "session-1",
      );
      const ack = sinon.stub();

      await socket.handlers["auth:refresh"]({ accessToken }, ack);

      expect(ack.firstCall.args[0].ok).to.be.false;
    });

    it("auth:refresh rejects a token of a revoked session", async () => {
      const socket = await connect();
      const { accessToken } = await tokens.issue(subject(), "session-1");

      await tokens.revokeSessions(["session-1"]);

      const ack = sinon.stub();

      await socket.handlers["auth:refresh"]({ accessToken }, ack);

      expect(ack.firstCall.args[0]).to.include({ ok: false });
    });

    it("auth:refresh without a token answers ok: false", async () => {
      const socket = await connect();
      const ack = sinon.stub();

      await socket.handlers["auth:refresh"]({}, ack);

      expect(ack.firstCall.args[0].ok).to.be.false;
    });

    it("stops the timers on disconnect", async () => {
      const socket = await connect();

      socket.handlers.disconnect();
      await clock.tickAsync(ttlMs() + SOCKET_AUTH_GRACE_MS + 1);

      expect(socket.emit.called).to.be.false;
      expect(socket.disconnect.called).to.be.false;
    });

    it("rejects the handshake of a revoked session", async () => {
      const { accessToken } = await tokens.issue(subject(), "session-9");

      await tokens.revokeSessions(["session-9"]);

      const socket = makeLiveSocket(accessToken);
      const next = sinon.stub();

      await mw.handle(socket as any, next);

      expect(next.firstCall.args[0]).to.be.instanceOf(Error);
    });
  });
});
