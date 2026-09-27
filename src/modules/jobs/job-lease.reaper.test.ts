import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { JobLeaseReaper } from "./job-lease.reaper";
import { EJobRunStatus } from "./jobs.types";

describe("JobLeaseReaper", () => {
  const run = () => ({ id: "job-1", queue: "demo.echo", status: "running" });
  let runs: { findExpiredLeases: sinon.SinonStub };
  let tracker: Record<string, sinon.SinonStub>;
  let boss: { fail: sinon.SinonStub };
  let bossService: { ready: sinon.SinonStub; findJob: sinon.SinonStub };
  let reaper: JobLeaseReaper;

  beforeEach(() => {
    runs = { findExpiredLeases: sinon.stub().resolves([run()]) };
    tracker = {
      fail: sinon.stub().resolves(),
      cancelled: sinon.stub().resolves(),
      update: sinon.stub().resolves(),
    };
    boss = { fail: sinon.stub().resolves() };
    bossService = { ready: sinon.stub().resolves(boss), findJob: sinon.stub() };
    reaper = new JobLeaseReaper(
      runs as any,
      tracker as any,
      bossService as any,
    );
  });

  it("активную задачу проваливает в pg-boss; есть повторы — запись в очереди", async () => {
    bossService.findJob.onFirstCall().resolves({ state: "active" });
    bossService.findJob.onSecondCall().resolves({ state: "retry" });

    expect(await reaper.reap()).to.equal(1);
    expect(boss.fail.firstCall.args[2]).to.include({ code: "LEASE_EXPIRED" });
    expect(tracker.fail.firstCall.args[2]).to.equal(false);
  });

  it("повторов нет — запись failed", async () => {
    bossService.findJob.onFirstCall().resolves({ state: "active" });
    bossService.findJob.onSecondCall().resolves({ state: "failed" });

    await reaper.reap();
    expect(tracker.fail.firstCall.args[2]).to.equal(true);
  });

  it("задачи в pg-boss нет — failed; отменена — cancelled; выполнена — completed", async () => {
    runs.findExpiredLeases.resolves([run(), run(), run()]);
    bossService.findJob.onCall(0).resolves(null);
    bossService.findJob.onCall(1).resolves({ state: "cancelled" });
    bossService.findJob.onCall(2).resolves({ state: "completed" });

    await reaper.reap();

    expect(boss.fail.called).to.be.false;
    expect(tracker.fail.firstCall.args[2]).to.equal(true);
    expect(tracker.cancelled.calledOnce).to.be.true;
    expect(tracker.update.firstCall.args[1]).to.include({
      status: EJobRunStatus.COMPLETED,
    });
  });

  it("сбой одной задачи не мешает остальным", async () => {
    runs.findExpiredLeases.resolves([run(), run()]);
    bossService.findJob.onCall(0).rejects(new Error("db"));
    bossService.findJob.onCall(1).resolves({ state: "created" });

    expect(await reaper.reap()).to.equal(2);
    expect(tracker.fail.calledOnce).to.be.true;
  });
});
