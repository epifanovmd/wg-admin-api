import { expect } from "chai";

import {
  checkWithTimeout,
  IHealthIndicator,
  probeRedis,
  runHealthIndicators,
} from "./health";

const never = () => new Promise<never>(() => undefined);

describe("health checks", () => {
  it("checkWithTimeout: результат, исключение и таймаут", async () => {
    expect(await checkWithTimeout(async () => true)).to.be.true;
    expect(
      await checkWithTimeout(async () => {
        throw new Error("down");
      }),
    ).to.be.false;
    expect(await checkWithTimeout(never, 20)).to.be.false;
  });

  it("probeRedis: не настроен, PONG, ошибка, зависание", async () => {
    expect(await probeRedis(undefined)).to.equal("not_configured");
    expect(await probeRedis({ ping: async () => "PONG" })).to.equal("ok");
    expect(
      await probeRedis({ ping: () => Promise.reject(new Error("ECONN")) }),
    ).to.equal("error");
    expect(await probeRedis({ ping: never }, 20)).to.equal("error");
  });

  it("runHealthIndicators: критичность по умолчанию и явная", async () => {
    const indicators: IHealthIndicator[] = [
      { name: "queue", check: async () => true },
      { name: "optional", critical: false, check: async () => false },
    ];

    expect(await runHealthIndicators(indicators)).to.deep.equal([
      { name: "queue", critical: true, status: "ok" },
      { name: "optional", critical: false, status: "error" },
    ]);
  });
});
