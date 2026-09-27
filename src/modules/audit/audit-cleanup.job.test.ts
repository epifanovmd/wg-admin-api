import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { AuditCleanupJob } from "./audit-cleanup.job";

describe("AuditCleanupJob", () => {
  it("is a cron job that runs the cleanup", async () => {
    const cleanup = sinon.stub().resolves(0);
    const job = new AuditCleanupJob({ cleanup } as any);

    expect(job.definition.queue).to.equal("audit.cleanup");
    expect(job.definition.cron).to.be.a("string");

    await job.handle();

    expect(cleanup.calledOnce).to.be.true;
  });
});
