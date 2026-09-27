import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { PasskeyChallengeCleanupJob } from "./passkey-challenge-cleanup.job";

describe("PasskeyChallengeCleanupJob", () => {
  it("runs by cron and removes expired challenges", async () => {
    const cleanupExpiredChallenges = sinon.stub().resolves(1);
    const job = new PasskeyChallengeCleanupJob({
      cleanupExpiredChallenges,
    } as any);

    expect(job.definition).to.include({
      queue: "passkeys.challenge-cleanup",
      cron: "*/15 * * * *",
    });

    await job.handle();

    expect(cleanupExpiredChallenges.calledOnce).to.be.true;
  });
});
