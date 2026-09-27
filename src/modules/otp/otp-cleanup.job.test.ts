import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { OtpCleanupJob } from "./otp-cleanup.job";

describe("OtpCleanupJob", () => {
  it("runs by cron and removes expired codes", async () => {
    const deleteExpired = sinon.stub().resolves(0);
    const job = new OtpCleanupJob({ deleteExpired } as any);

    expect(job.definition.queue).to.equal("otp.cleanup");
    expect(job.definition.cron).to.be.a("string");

    await job.handle();

    expect(deleteExpired.calledOnce).to.be.true;
  });
});
