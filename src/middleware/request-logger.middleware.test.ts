import { expect } from "chai";
import sinon from "sinon";

import { logger } from "../core/logger";
import { requestLoggerMiddleware } from "./request-logger.middleware";

const run = async (url: string, status: number) => {
  const ctx = { request: { method: "GET", url }, path: url, status, state: {} };

  await requestLoggerMiddleware(ctx as any, async () => {});
};

describe("requestLoggerMiddleware", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    (["info", "warn", "error"] as const).forEach(level =>
      sandbox.stub(logger, level),
    );
  });

  afterEach(() => sandbox.restore());

  it("пробы оркестратора (/ping, /ready) не пишутся в лог", async () => {
    await run("/ping", 200);
    await run("/ready", 503);

    expect((logger.info as sinon.SinonStub).called).to.be.false;
    expect((logger.error as sinon.SinonStub).called).to.be.false;
  });

  it("обычные запросы логируются по статусу", async () => {
    await run("/api/user/my", 200);
    await run("/api/user/my", 401);
    await run("/api/user/my", 500);

    expect((logger.info as sinon.SinonStub).calledOnce).to.be.true;
    expect((logger.warn as sinon.SinonStub).calledOnce).to.be.true;
    expect((logger.error as sinon.SinonStub).calledOnce).to.be.true;
  });

  it("медленный запрос — warn, long-poll (state.longPoll) — info", async () => {
    const clock = sandbox.useFakeTimers();
    const slow = async (state: Record<string, unknown>) => {
      const ctx = {
        request: { method: "POST", url: "/api/x" },
        path: "/api/x",
        status: 200,
        state,
      };

      await requestLoggerMiddleware(ctx as any, async () => {
        clock.tick(5_000);
      });
    };

    await slow({});
    await slow({ longPoll: true });

    expect((logger.warn as sinon.SinonStub).calledOnce).to.be.true;
    expect((logger.info as sinon.SinonStub).calledOnce).to.be.true;
  });
});
