import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { SessionCleanupJob } from "./session-cleanup.job";

describe("SessionCleanupJob", () => {
  it("runs hourly by cron and removes expired sessions", async () => {
    const cleanupExpired = sinon.stub().resolves(2);
    const job = new SessionCleanupJob({ cleanupExpired } as any);

    expect(job.definition).to.include({
      queue: "session.cleanup",
      cron: "0 * * * *",
    });

    await job.handle();

    expect(cleanupExpired.calledOnce).to.be.true;
  });
});
