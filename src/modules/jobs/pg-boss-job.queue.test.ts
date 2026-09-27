import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { HttpException } from "../../core";
import { JobsError } from "./jobs.errors";
import { EJobRunStatus } from "./jobs.types";
import { PgBossJobQueue } from "./pg-boss-job.queue";

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail("должно было упасть");
  } catch (err) {
    expect(err).to.be.instanceOf(HttpException);
    expect((err as HttpException).code).to.equal(code);
  }
};

describe("PgBossJobQueue", () => {
  let boss: {
    send: sinon.SinonStub;
    cancel: sinon.SinonStub;
  };
  let bossService: { ready: sinon.SinonStub; findJob: sinon.SinonStub };
  let registry: { definition: sinon.SinonStub };
  let tracker: Record<string, sinon.SinonStub>;
  let watcher: { notify: sinon.SinonStub };
  let waiter: { wait: sinon.SinonStub };
  let dataSource: { transaction: sinon.SinonStub };
  let txManager: { queryRunner: { query: sinon.SinonStub } };
  let queue: PgBossJobQueue;

  beforeEach(() => {
    boss = {
      send: sinon.stub().resolves("job-1"),
      cancel: sinon.stub().resolves({ affected: 1 }),
    };
    bossService = {
      ready: sinon.stub().resolves(boss),
      findJob: sinon.stub().resolves(null),
    };
    registry = {
      definition: sinon.stub().returns({ queue: "mail.send", tracked: false }),
    };
    tracker = {
      create: sinon
        .stub()
        .callsFake(async (_m, data) => ({ ...data, status: "queued" })),
      publish: sinon.stub(),
      find: sinon.stub().resolves(null),
      cancelled: sinon.stub().resolves(),
      update: sinon.stub().resolves(),
    };
    watcher = { notify: sinon.stub().resolves() };
    waiter = { wait: sinon.stub().resolves(null) };
    txManager = {
      queryRunner: {
        query: sinon.stub().resolves({ records: [{ id: "job-1" }] }),
      },
    };
    dataSource = {
      transaction: sinon.stub().callsFake(async (cb: any) => cb(txManager)),
    };
    queue = new PgBossJobQueue(
      bossService as any,
      registry as any,
      tracker as any,
      watcher as any,
      waiter as any,
      dataSource as any,
    );
  });

  it("неизвестная очередь — ошибка JOB_UNKNOWN_QUEUE", async () => {
    registry.definition.returns(undefined);
    await expectCode(queue.enqueue("nope", {}), JobsError.codes.UNKNOWN_QUEUE);
  });

  it("служебная очередь: send без записи и транзакции", async () => {
    const id = await queue.enqueue(
      "mail.send",
      { to: "a" },
      { startAfter: 30, singletonKey: "k", priority: 5 },
    );

    expect(id).to.equal("job-1");
    expect(boss.send.firstCall.args[2]).to.deep.equal({
      startAfter: 30,
      singletonKey: "k",
      priority: 5,
    });
    expect(dataSource.transaction.called).to.be.false;
    expect(tracker.create.called).to.be.false;
  });

  it("служебная очередь с manager: send через транзакцию (outbox)", async () => {
    await queue.enqueue("mail.send", {}, { manager: txManager as any });

    const { db } = boss.send.firstCall.args[2];
    const result = await db.executeSql("SELECT 1", [1]);

    expect(txManager.queryRunner.query.calledWith("SELECT 1", [1], true)).to.be
      .true;
    expect(result).to.deep.equal({ rows: [{ id: "job-1" }] });
  });

  it("видимая очередь: запись в своей транзакции и событие после коммита", async () => {
    registry.definition.returns({ queue: "file.process", tracked: true });

    const id = await queue.enqueue(
      "file.process",
      { fileId: "f" },
      {
        title: "Обработка",
        ownerId: "u1",
        scope: { type: "workspace", id: "w1" },
      },
    );

    expect(id).to.equal("job-1");
    expect(dataSource.transaction.calledOnce).to.be.true;
    expect(boss.send.firstCall.args[2].db).to.exist;
    expect(tracker.create.firstCall.args[0]).to.equal(txManager);
    expect(tracker.create.firstCall.args[1]).to.deep.equal({
      id: "job-1",
      queue: "file.process",
      title: "Обработка",
      ownerId: "u1",
      scope: { type: "workspace", id: "w1" },
    });
    expect(tracker.publish.calledOnce).to.be.true;
  });

  it("track: true у служебной очереди — тоже с записью", async () => {
    await queue.enqueue("mail.send", {}, { track: true });
    expect(tracker.create.calledOnce).to.be.true;
  });

  it("видимая очередь с чужой транзакцией — запись в ней, без события", async () => {
    registry.definition.returns({ queue: "file.process", tracked: true });

    await queue.enqueue("file.process", {}, { manager: txManager as any });

    expect(dataSource.transaction.called).to.be.false;
    expect(tracker.create.firstCall.args[0]).to.equal(txManager);
    expect(tracker.publish.called).to.be.false;
  });

  it("дедупликация: send вернул null — записи нет", async () => {
    registry.definition.returns({ queue: "file.process", tracked: true });
    boss.send.resolves(null);

    expect(await queue.enqueue("file.process", {})).to.be.null;
    expect(tracker.create.called).to.be.false;
    expect(tracker.publish.called).to.be.false;
  });

  describe("request", () => {
    beforeEach(() => {
      registry.definition.returns({ queue: "ml.predict", tracked: true });
    });

    it("ставит видимую задачу и возвращает её результат", async () => {
      waiter.wait.resolves({
        id: "job-1",
        status: EJobRunStatus.COMPLETED,
        result: { boxes: 3 },
      });

      const result = await queue.request(
        "ml.predict",
        { imageId: "i" },
        { priority: 10, timeoutMs: 5_000 },
      );

      expect(result).to.deep.equal({ boxes: 3 });
      expect(tracker.create.calledOnce).to.be.true;
      expect(boss.send.firstCall.args[2].priority).to.equal(10);
      expect(waiter.wait.calledOnceWith("job-1", 5_000)).to.be.true;
    });

    it("ошибка задачи — JOB_REQUEST_FAILED с её кодом", async () => {
      waiter.wait.resolves({
        id: "job-1",
        status: EJobRunStatus.FAILED,
        error: { code: "MODEL_NOT_FOUND", message: "нет весов" },
      });

      try {
        await queue.request("ml.predict", {});
        expect.fail("должно было упасть");
      } catch (err) {
        expect((err as HttpException).code).to.equal(
          JobsError.codes.REQUEST_FAILED,
        );
        expect((err as HttpException).status).to.equal(502);
        expect((err as HttpException).reason).to.include({
          code: "MODEL_NOT_FOUND",
        });
      }
    });

    it("таймаут — задача снимается, JOB_REQUEST_TIMEOUT (504)", async () => {
      tracker.find.resolves({
        id: "job-1",
        queue: "ml.predict",
        status: EJobRunStatus.QUEUED,
      });

      await expectCode(
        queue.request("ml.predict", {}, { timeoutMs: 10 }),
        JobsError.codes.REQUEST_TIMEOUT,
      );
      expect(boss.cancel.calledWith("ml.predict", "job-1")).to.be.true;
    });
  });

  describe("cancel", () => {
    it("ждущая видимая задача — cancelled сразу, cancel в pg-boss и NOTIFY", async () => {
      const run = { id: "job-1", queue: "q", status: EJobRunStatus.QUEUED };

      tracker.find.resolves(run);
      await queue.cancel("job-1");

      expect(tracker.cancelled.calledWith(run)).to.be.true;
      expect(boss.cancel.calledWith("q", "job-1")).to.be.true;
      expect(watcher.notify.calledWith("job-1")).to.be.true;
    });

    it("выполняющаяся Node-задача — только флаг, завершит воркер", async () => {
      const run = { id: "job-1", queue: "q", status: EJobRunStatus.RUNNING };

      tracker.find.resolves(run);
      await queue.cancel("job-1");

      expect(tracker.update.calledWith(run, { cancelRequested: true })).to.be
        .true;
      expect(tracker.cancelled.called).to.be.false;
      expect(watcher.notify.calledOnce).to.be.true;
    });

    it("завершённая — ничего не делает", async () => {
      tracker.find.resolves({ id: "job-1", queue: "q", status: "completed" });
      await queue.cancel("job-1");

      expect(boss.cancel.called).to.be.false;
    });

    it("невидимая задача — очередь из pg-boss", async () => {
      bossService.findJob.resolves({ queue: "mail.send", state: "created" });
      await queue.cancel("job-1");

      expect(boss.cancel.calledWith("mail.send", "job-1")).to.be.true;
    });

    it("неизвестная задача — JOB_NOT_FOUND", async () => {
      await expectCode(queue.cancel("job-x"), JobsError.codes.NOT_FOUND);
    });
  });
});
