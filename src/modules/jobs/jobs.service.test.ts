import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { HttpException } from "../../core";
import { createMockJobQueue, uuid, uuid2 } from "../../test/helpers";
import { JobsError } from "./jobs.errors";
import { JobsService } from "./jobs.service";
import { EJobRunStatus } from "./jobs.types";

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  queue: "file.process",
  status: EJobRunStatus.RUNNING,
  title: "t",
  progress: 0,
  progressText: null,
  logTail: [],
  result: null,
  error: null,
  ownerId: uuid(),
  scopeType: null,
  scopeId: null,
  attempt: 0,
  cancelRequested: false,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail("должно было упасть");
  } catch (err) {
    expect((err as HttpException).code).to.equal(code);
  }
};

describe("JobsService", () => {
  const owner = { userId: uuid(), isSuperUser: false };
  const stranger = { userId: uuid2(), isSuperUser: false };
  let runs: { findById: sinon.SinonStub; findPage: sinon.SinonStub };
  let jobQueue: ReturnType<typeof createMockJobQueue>;
  let policy: { scopeType: string; canAccess: sinon.SinonStub };
  let service: JobsService;

  beforeEach(() => {
    runs = {
      findById: sinon.stub().resolves(run()),
      findPage: sinon.stub().resolves([[run()], 1]),
    };
    jobQueue = createMockJobQueue();
    policy = {
      scopeType: "workspace",
      canAccess: sinon.stub().resolves(false),
    };
    service = new JobsService(runs as any, jobQueue as any, [policy]);
  });

  describe("list", () => {
    it("без scope — свои задачи, страница по умолчанию", async () => {
      const page = await service.list(owner, {});

      expect(runs.findPage.firstCall.args[0]).to.deep.include({
        ownerId: owner.userId,
        offset: 0,
        limit: 20,
      });
      expect(page.total).to.equal(1);
      expect(page.items[0].id).to.equal("job-1");
    });

    it("по scope — если политика разрешает просмотр", async () => {
      policy.canAccess.resolves(true);

      await service.list(stranger, {
        scopeType: "workspace",
        scopeId: "w1",
        status: EJobRunStatus.FAILED,
      });

      expect(policy.canAccess.calledWith(stranger.userId, "w1", "view")).to.be
        .true;
      expect(runs.findPage.firstCall.args[0]).to.deep.include({
        scope: { type: "workspace", id: "w1" },
        statuses: [EJobRunStatus.FAILED],
      });
    });

    it("по scope без разрешения — 403", async () => {
      await expectCode(
        service.list(stranger, { scopeType: "workspace", scopeId: "w1" }),
        JobsError.codes.FORBIDDEN,
      );
    });

    it("scope неизвестного типа — 403", async () => {
      await expectCode(
        service.list(stranger, { scopeType: "project", scopeId: "p1" }),
        JobsError.codes.FORBIDDEN,
      );
    });
  });

  describe("get", () => {
    it("владелец видит задачу", async () => {
      expect((await service.get(owner, "job-1")).id).to.equal("job-1");
    });

    it("чужой без scope — 403", async () => {
      await expectCode(
        service.get(stranger, "job-1"),
        JobsError.codes.FORBIDDEN,
      );
    });

    it("чужой участник scope — по политике", async () => {
      runs.findById.resolves(run({ scopeType: "workspace", scopeId: "w1" }));
      policy.canAccess.resolves(true);

      expect((await service.get(stranger, "job-1")).id).to.equal("job-1");
    });

    it("суперпользователь видит любую", async () => {
      expect(
        (await service.get({ userId: uuid2(), isSuperUser: true }, "job-1")).id,
      ).to.equal("job-1");
    });

    it("нет задачи — 404", async () => {
      runs.findById.resolves(null);
      await expectCode(service.get(owner, "job-1"), JobsError.codes.NOT_FOUND);
    });
  });

  describe("cancel", () => {
    it("владелец отменяет активную", async () => {
      await service.cancel(owner, "job-1");
      expect(jobQueue.cancel.calledWith("job-1")).to.be.true;
    });

    it("завершённую — 409", async () => {
      runs.findById.resolves(run({ status: EJobRunStatus.COMPLETED }));
      await expectCode(
        service.cancel(owner, "job-1"),
        JobsError.codes.NOT_CANCELLABLE,
      );
    });

    it("политика спрашивается с действием cancel", async () => {
      runs.findById.resolves(run({ scopeType: "workspace", scopeId: "w1" }));
      policy.canAccess.callsFake(async (_u, _s, action) => action === "view");

      await expectCode(
        service.cancel(stranger, "job-1"),
        JobsError.codes.FORBIDDEN,
      );
    });
  });

  it("canView — для комнаты сокета", async () => {
    expect(await service.canView(owner.userId, "job-1")).to.be.true;
    expect(await service.canView(stranger.userId, "job-1")).to.be.false;
    runs.findById.resolves(null);
    expect(await service.canView(owner.userId, "job-1")).to.be.false;
  });
});
