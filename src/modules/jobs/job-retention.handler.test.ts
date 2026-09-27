import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { config } from "../../config";
import { JobRetentionJobHandler } from "./job-retention.handler";

describe("JobRetentionJobHandler", () => {
  it("удаляет завершённые записи старше срока хранения — раз в сутки", async () => {
    const runs = { deleteSettledBefore: sinon.stub().resolves(7) };
    const handler = new JobRetentionJobHandler(runs as any);

    expect(handler.definition.cron).to.equal("30 3 * * *");
    expect(await handler.handle()).to.equal(7);

    const before: Date = runs.deleteSettledBefore.firstCall.args[0];
    const expected = Date.now() - config.jobs.retentionDays * 86_400_000;

    expect(before.getTime()).to.be.closeTo(expected, 1_000);
  });
});
