import "reflect-metadata";

import { expect } from "chai";

import { JobsHealthIndicator } from "./jobs.health";

describe("JobsHealthIndicator", () => {
  it("здорова, пока очередь запущена", async () => {
    const indicator = new JobsHealthIndicator({ isStarted: true } as any);

    expect(indicator.name).to.equal("jobs");
    expect(await indicator.check()).to.equal(true);
  });

  it("очередь не запущена — отказ", async () => {
    const indicator = new JobsHealthIndicator({ isStarted: false } as any);

    expect(await indicator.check()).to.equal(false);
  });
});
