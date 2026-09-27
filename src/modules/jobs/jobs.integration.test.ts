import "reflect-metadata";

import { expect } from "chai";
import { Client } from "pg";
import type { ConstructorOptions } from "pg-boss";
import { PgBoss } from "pg-boss";
import { setTimeout as sleep } from "timers/promises";
import { DataSource } from "typeorm";

import { EventBus, IJobHandler, JobContext, JobError } from "../../core";
import { JobRunner } from "./job.runner";
import { JobCancelWatcher } from "./job-cancel.watcher";
import { JobHandlerRegistry } from "./job-handler.registry";
import { JobLeaseReaper } from "./job-lease.reaper";
import { JobResultWaiter } from "./job-result.waiter";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobRunTracker } from "./job-run.tracker";
import { JobSignals } from "./job-signals";
import { JobsBootstrap } from "./jobs.bootstrap";
import { EJobRunStatus, PGBOSS_SCHEMA } from "./jobs.types";
import { PgBossService } from "./pg-boss.service";
import { PgBossJobQueue } from "./pg-boss-job.queue";

/**
 * Интеграция с настоящим Postgres: `TEST_DATABASE_URL=postgres://…`.
 * Без переменной набор пропускается. БД — одноразовая: схема pgboss и
 * таблица job_runs пересоздаются.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const waitFor = async <T>(
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await probe();

    if (value) return value;
    await sleep(100);
  }

  return expect.fail(`условие не выполнилось за ${timeoutMs} мс`);
};

class TestPgBossService extends PgBossService {
  protected createBoss(options: ConstructorOptions): PgBoss {
    const { host, port, database, user, password, ssl, ...rest } = options;

    void [host, port, database, user, password, ssl];

    return new PgBoss({ ...rest, connectionString: DATABASE_URL });
  }
}

class TestSignals extends JobSignals {
  protected createClient(): Client {
    return new Client({ connectionString: DATABASE_URL });
  }
}

const flakyAttempts: number[] = [];

const handlers: IJobHandler<any, any>[] = [
  {
    definition: { queue: "it.echo", tracked: true },
    handle: async (ctx: JobContext<{ text: string }>) => {
      await ctx.progress(0.5, "половина");
      await ctx.log("эхо");

      return { echo: ctx.data.text };
    },
  },
  {
    definition: {
      queue: "it.flaky",
      tracked: true,
      retryLimit: 2,
      retryDelaySeconds: 1,
      retryBackoff: false,
    },
    handle: async (ctx: JobContext) => {
      flakyAttempts.push(ctx.attempt);
      if (ctx.attempt === 0) throw new Error("временный сбой");

      return { ok: true };
    },
  },
  {
    definition: { queue: "it.fatal", tracked: true, retryLimit: 3 },
    handle: async () => {
      throw new JobError("BAD_INPUT", "плохие данные", false);
    },
  },
  {
    definition: { queue: "it.slow", tracked: true },
    handle: (ctx: JobContext) =>
      new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () =>
          reject(new Error("прервано")),
        );
      }),
  },
  {
    definition: { queue: "it.plain" },
    handle: async () => undefined,
  },
];

describe("JobQueue на pg-boss (интеграция, TEST_DATABASE_URL)", function () {
  this.timeout(60_000);

  let dataSource: DataSource;
  let boss: TestPgBossService;
  let tracker: JobRunTracker;
  let queue: PgBossJobQueue;
  let bootstrap: JobsBootstrap;
  let reaper: JobLeaseReaper;
  let runs: JobRunRepository;
  let signals: TestSignals;

  const bossState = async (id: string) => (await boss.findJob(id))?.state;

  before(async function () {
    if (!DATABASE_URL) this.skip();

    dataSource = new DataSource({
      type: "postgres",
      url: DATABASE_URL,
      entities: [JobRun],
    });
    await dataSource.initialize();
    await dataSource.query(`DROP SCHEMA IF EXISTS ${PGBOSS_SCHEMA} CASCADE`);
    await dataSource.query("DROP TABLE IF EXISTS job_runs");
    await dataSource.synchronize();
    await dataSource.query(
      "CREATE TABLE IF NOT EXISTS it_outbox (id serial PRIMARY KEY, note text)",
    );

    const eventBus = new EventBus();

    runs = new JobRunRepository(dataSource, JobRun);
    signals = new TestSignals(dataSource);
    tracker = new JobRunTracker(runs, eventBus, signals);
    boss = new TestPgBossService();

    const registry = new JobHandlerRegistry();
    const watcher = new JobCancelWatcher(signals, runs, boss);

    reaper = new JobLeaseReaper(runs, tracker, boss);
    queue = new PgBossJobQueue(
      boss,
      registry,
      tracker,
      watcher,
      new JobResultWaiter(signals, runs),
      dataSource,
    );
    bootstrap = new JobsBootstrap(
      boss,
      registry,
      new JobRunner(tracker, watcher),
      watcher,
      signals,
      reaper,
      handlers,
    );

    await bootstrap.initialize();
    expect(watcher.isListening).to.be.true;
  });

  after(async () => {
    await bootstrap?.destroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("enqueue → work → complete: запись, прогресс, результат", async () => {
    const id = (await queue.enqueue(
      "it.echo",
      { text: "привет" },
      { title: "Эхо", ownerId: "00000000-0000-0000-0000-000000000001" },
    )) as string;

    const run = await waitFor(async () => {
      const found = await runs.findById(id);

      return found?.status === EJobRunStatus.COMPLETED && found;
    });

    expect(run.result).to.deep.equal({ echo: "привет" });
    expect(run.progress).to.equal(1);
    expect(run.title).to.equal("Эхо");
    expect(run.logTail[0]).to.match(/эхо$/);
    expect(run.startedAt).to.be.instanceOf(Date);
    expect(await bossState(id)).to.equal("completed");
  });

  it("повтор после ошибки: вторая попытка успешна", async () => {
    const id = (await queue.enqueue("it.flaky", {})) as string;

    const run = await waitFor(async () => {
      const found = await runs.findById(id);

      return found?.status === EJobRunStatus.COMPLETED && found;
    });

    expect(flakyAttempts).to.deep.equal([0, 1]);
    expect(run.attempt).to.equal(1);
  });

  it("JobError retryable=false — без повторов, failed", async () => {
    const id = (await queue.enqueue("it.fatal", {})) as string;

    const run = await waitFor(async () => {
      const found = await runs.findById(id);

      return found?.status === EJobRunStatus.FAILED && found;
    });

    expect(run.error).to.deep.equal({
      code: "BAD_INPUT",
      message: "плохие данные",
    });
    expect(run.attempt).to.equal(0);
    await waitFor(async () => (await bossState(id)) === "failed");
  });

  it("отмена выполняющейся задачи через NOTIFY: сигнал, cancelled", async () => {
    const id = (await queue.enqueue("it.slow", {})) as string;

    await waitFor(
      async () => (await runs.findById(id))?.status === EJobRunStatus.RUNNING,
    );
    await queue.cancel(id);

    const run = await waitFor(async () => {
      const found = await runs.findById(id);

      return found?.status === EJobRunStatus.CANCELLED && found;
    });

    expect(run.cancelRequested).to.be.true;
    expect(await bossState(id)).to.equal("cancelled");
  });

  it("отмена ждущей задачи — сразу cancelled", async () => {
    const id = (await queue.enqueue(
      "it.slow",
      {},
      { startAfter: 3600 },
    )) as string;

    await queue.cancel(id);

    expect((await runs.findById(id))?.status).to.equal(EJobRunStatus.CANCELLED);
    expect(await bossState(id)).to.equal("cancelled");
  });

  it("outbox: откат транзакции отменяет и задачу, и запись", async () => {
    let jobId: string | null = null;

    try {
      await dataSource.transaction(async manager => {
        await manager.query("INSERT INTO it_outbox (note) VALUES ('rollback')");
        jobId = await queue.enqueue("it.echo", { text: "x" }, { manager });
        throw new Error("откат");
      });
    } catch {
      // ожидаемо
    }

    expect(jobId).to.be.a("string");
    expect(await boss.findJob(jobId as unknown as string)).to.be.null;
    expect(await runs.findById(jobId as unknown as string)).to.be.null;

    const [{ count }] = await dataSource.query(
      "SELECT count(*)::int AS count FROM it_outbox WHERE note = 'rollback'",
    );

    expect(count).to.equal(0);
  });

  it("outbox: коммит — задача и запись появляются вместе", async () => {
    const id = await dataSource.transaction(async manager => {
      await manager.query("INSERT INTO it_outbox (note) VALUES ('commit')");

      return queue.enqueue("it.plain", {}, { manager, track: true });
    });

    await waitFor(
      async () =>
        (await runs.findById(id as string))?.status === EJobRunStatus.COMPLETED,
    );
  });

  it("request: результат Node-задачи доходит до ждущего", async () => {
    const result = await queue.request<{ text: string }, { echo: string }>(
      "it.echo",
      { text: "ping" },
      { timeoutMs: 10_000 },
    );

    expect(result).to.deep.equal({ echo: "ping" });
  });

  it("request: ошибка задачи — 502 с её кодом; таймаут — 504 и задача снята", async () => {
    try {
      await queue.request("it.fatal", {}, { timeoutMs: 10_000 });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.status).to.equal(502);
      expect(err.reason).to.include({ code: "BAD_INPUT" });
    }

    try {
      await queue.request("it.slow", {}, { timeoutMs: 300 });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.status).to.equal(504);
    }
  });
});
