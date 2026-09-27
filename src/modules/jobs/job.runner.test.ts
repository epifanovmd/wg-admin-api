import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { getRequestId, JobError } from "../../core";
import { JobRunner } from "./job.runner";
import { JOB_CANCELLED_REASON } from "./job-cancel.watcher";
import { EJobRunStatus } from "./jobs.types";

const createJob = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "job-1",
    name: "test.queue",
    data: { x: 1 },
    retryCount: 0,
    retryLimit: 3,
    signal: new AbortController().signal,
    ...overrides,
  }) as any;

const createRun = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  queue: "test.queue",
  status: EJobRunStatus.RUNNING,
  cancelRequested: false,
  logTail: [],
  ...overrides,
});

const createTracker = () => ({
  start: sinon.stub().resolves(createRun()),
  progress: sinon.stub().resolves(),
  complete: sinon.stub().resolves(),
  fail: sinon.stub().resolves(),
  cancelled: sinon.stub().resolves(),
  extendLease: sinon.stub().resolves(true),
});

const createWatcher = () => {
  const controllers = new Map<string, AbortController>();

  return {
    controllers,
    watch: sinon.stub().callsFake((id: string, c: AbortController) => {
      controllers.set(id, c);

      return () => controllers.delete(id);
    }),
  };
};

const handlerOf = (handle: (ctx: any) => Promise<unknown>) => ({
  definition: { queue: "test.queue", tracked: true },
  handle: sinon.stub().callsFake(handle),
});

describe("JobRunner", () => {
  let tracker: ReturnType<typeof createTracker>;
  let watcher: ReturnType<typeof createWatcher>;
  let metrics: { onStart: sinon.SinonStub; onComplete: sinon.SinonStub };
  let runner: JobRunner;

  beforeEach(() => {
    tracker = createTracker();
    watcher = createWatcher();
    metrics = { onStart: sinon.stub(), onComplete: sinon.stub() };
    runner = new JobRunner(tracker as any, watcher as any, metrics);
  });

  it("выполняет задачу в контексте requestId job:<queue>:<id> и завершает запись", async () => {
    let requestId: string | undefined;
    const handler = handlerOf(async ctx => {
      requestId = getRequestId();
      expect(ctx).to.include({ id: "job-1", queue: "test.queue", attempt: 0 });
      expect(ctx.data).to.deep.equal({ x: 1 });

      return { done: true };
    });

    const result = await runner.run(handler as any, createJob(), true);

    expect(requestId).to.equal("job:test.queue:job-1");
    expect(result).to.deep.equal({
      id: "job-1",
      status: "completed",
      output: { done: true },
    });
    expect(tracker.start.firstCall.args[0]).to.include({
      id: "job-1",
      createIfMissing: true,
    });
    expect(tracker.complete.calledOnce).to.be.true;
    expect(metrics.onStart.calledWith("test.queue")).to.be.true;
    expect(metrics.onComplete.firstCall.args[2]).to.equal(true);
    expect(watcher.controllers.size).to.equal(0);
  });

  it("ошибка с повторами — failed, запись снова в очереди", async () => {
    const handler = handlerOf(async () => {
      throw new Error("сеть");
    });

    const result = await runner.run(handler as any, createJob(), true);

    expect(result).to.deep.include({ status: "failed" });
    expect(result.output).to.deep.equal({
      code: "JOB_FAILED",
      message: "сеть",
    });
    expect(tracker.fail.firstCall.args[2]).to.equal(false);
    expect(metrics.onComplete.firstCall.args[2]).to.equal(false);
  });

  it("последняя попытка — запись failed окончательно", async () => {
    const handler = handlerOf(async () => {
      throw new Error("сеть");
    });

    await runner.run(
      handler as any,
      createJob({ retryCount: 3, retryLimit: 3 }),
      true,
    );

    expect(tracker.fail.firstCall.args[2]).to.equal(true);
  });

  it("JobError retryable=false — deadletter без повторов", async () => {
    const handler = handlerOf(async () => {
      throw new JobError("BAD_INPUT", "плохие данные", false);
    });

    const result = await runner.run(handler as any, createJob(), true);

    expect(result).to.deep.equal({
      id: "job-1",
      status: "deadletter",
      output: { code: "BAD_INPUT", message: "плохие данные" },
    });
    expect(tracker.fail.firstCall.args[1]).to.deep.equal({
      code: "BAD_INPUT",
      message: "плохие данные",
    });
    expect(tracker.fail.firstCall.args[2]).to.equal(true);
  });

  it("отмена через watcher: сигнал срабатывает, запись cancelled", async () => {
    const handler = handlerOf(
      ctx =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          watcher.controllers.get("job-1")?.abort(JOB_CANCELLED_REASON);
        }),
    );

    const result = await runner.run(handler as any, createJob(), true);

    expect(result.status).to.equal("completed");
    expect(tracker.cancelled.calledOnce).to.be.true;
    expect(tracker.fail.called).to.be.false;
  });

  it("остановка процесса (сигнал pg-boss) — обычная ошибка с повтором", async () => {
    const bossAbort = new AbortController();
    const handler = handlerOf(
      ctx =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener("abort", () =>
            reject(new Error("shutdown")),
          );
          bossAbort.abort();
        }),
    );

    const result = await runner.run(
      handler as any,
      createJob({ signal: bossAbort.signal }),
      true,
    );

    expect(result.status).to.equal("failed");
    expect(tracker.cancelled.called).to.be.false;
  });

  it("отмена до старта — обработчик не вызывается", async () => {
    tracker.start.resolves(createRun({ cancelRequested: true }));

    const handler = handlerOf(async () => "never");
    const result = await runner.run(handler as any, createJob(), true);

    expect(handler.handle.called).to.be.false;
    expect(result.status).to.equal("completed");
    expect(tracker.cancelled.calledOnce).to.be.true;
  });

  it("невидимая задача: прогресс и лог не пишутся", async () => {
    tracker.start.resolves(null);

    const handler = handlerOf(async ctx => {
      await ctx.progress(0.5, "half");
      await ctx.log("line");

      return 42;
    });

    const result = await runner.run(handler as any, createJob(), false);

    expect(result.output).to.deep.equal({ value: 42 });
    expect(tracker.progress.called).to.be.false;
    expect(tracker.complete.called).to.be.false;
  });

  it("прогресс видимой задачи пишется в запись", async () => {
    const handler = handlerOf(async ctx => {
      await ctx.progress(0.5, "half");
      await ctx.log("line");
    });

    await runner.run(handler as any, createJob(), true);

    // Первая запись — сразу, лог после неё — финальным flush.
    expect(tracker.progress.firstCall.args.slice(1)).to.deep.equal([
      0.5,
      "half",
      [],
    ]);
    expect(tracker.progress.lastCall.args[3]).to.deep.equal(["line"]);
  });
});
