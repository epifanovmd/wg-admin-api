import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { JOB_CANCELLED_REASON, JobCancelWatcher } from "./job-cancel.watcher";
import { JOB_CANCEL_CHANNEL } from "./jobs.types";

/** Сигналы в памяти: канал → подписчики, статус LISTEN задаётся тестом. */
const createSignals = (listening: boolean) => {
  const handlers = new Map<string, (payload: string) => void>();
  let onStatus: ((listening: boolean) => void) | undefined;

  return {
    isListening: listening,
    start: sinon.stub().resolves(),
    notify: sinon.stub().resolves(),
    on: (channel: string, handler: (payload: string) => void) => {
      handlers.set(channel, handler);

      return () => handlers.delete(channel);
    },
    onStatus: (handler: (listening: boolean) => void) => {
      onStatus = handler;

      return () => undefined;
    },
    emit: (channel: string, payload: string) =>
      handlers.get(channel)?.(payload),
    setListening(value: boolean) {
      this.isListening = value;
      onStatus?.(value);
    },
  };
};

describe("JobCancelWatcher", () => {
  let runs: { findCancelRequestedIds: sinon.SinonStub };
  let boss: { findCancelledIds: sinon.SinonStub };

  beforeEach(() => {
    runs = { findCancelRequestedIds: sinon.stub().resolves([]) };
    boss = { findCancelledIds: sinon.stub().resolves([]) };
  });

  it("сигнал job_cancel отменяет локальную задачу", async () => {
    const signals = createSignals(true);
    const watcher = new JobCancelWatcher(
      signals as any,
      runs as any,
      boss as any,
    );

    await watcher.start();

    const controller = new AbortController();

    watcher.watch("job-1", controller);
    signals.emit(JOB_CANCEL_CHANNEL, "job-1");

    expect(controller.signal.aborted).to.be.true;
    expect(controller.signal.reason).to.equal(JOB_CANCELLED_REASON);
    await watcher.stop();
  });

  it("notify — сигнал job_cancel с id задачи", async () => {
    const signals = createSignals(true);
    const watcher = new JobCancelWatcher(
      signals as any,
      runs as any,
      boss as any,
    );

    await watcher.notify("job-1");
    expect(signals.notify.calledOnceWith(JOB_CANCEL_CHANNEL, "job-1")).to.be
      .true;
  });

  it("LISTEN недоступен — опрос флагов раз в 2 с", async () => {
    const clock = sinon.useFakeTimers();
    const signals = createSignals(false);
    const watcher = new JobCancelWatcher(
      signals as any,
      runs as any,
      boss as any,
    );

    try {
      await watcher.start();

      const controller = new AbortController();

      watcher.watch("job-1", controller);
      runs.findCancelRequestedIds.resolves(["job-1"]);

      await clock.tickAsync(2_000);

      expect(runs.findCancelRequestedIds.calledWith(["job-1"])).to.be.true;
      expect(controller.signal.aborted).to.be.true;
    } finally {
      await watcher.stop();
      clock.restore();
    }
  });

  it("LISTEN восстановился — опрос прекращается, пропущенное добирается", async () => {
    const clock = sinon.useFakeTimers();
    const signals = createSignals(false);
    const watcher = new JobCancelWatcher(
      signals as any,
      runs as any,
      boss as any,
    );

    try {
      await watcher.start();
      watcher.watch("job-1", new AbortController());
      signals.setListening(true);
      await clock.tickAsync(0);
      runs.findCancelRequestedIds.resetHistory();

      await clock.tickAsync(6_000);

      expect(runs.findCancelRequestedIds.called).to.be.false;
    } finally {
      await watcher.stop();
      clock.restore();
    }
  });

  it("опрос видит и отмену в pg-boss (невидимая задача)", async () => {
    const watcher = new JobCancelWatcher(
      createSignals(true) as any,
      runs as any,
      boss as any,
    );
    const controller = new AbortController();

    watcher.watch("job-2", controller);
    boss.findCancelledIds.resolves(["job-2"]);
    await watcher.poll();

    expect(controller.signal.aborted).to.be.true;
  });

  it("снятая с наблюдения задача не отменяется", () => {
    const watcher = new JobCancelWatcher(
      createSignals(true) as any,
      runs as any,
      boss as any,
    );
    const controller = new AbortController();
    const unwatch = watcher.watch("job-1", controller);

    unwatch();
    watcher.abort("job-1");

    expect(controller.signal.aborted).to.be.false;
  });
});
