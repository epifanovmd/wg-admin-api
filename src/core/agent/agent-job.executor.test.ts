import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../event-bus";
import { HttpException } from "../http";
import { JobError } from "../jobs";
import { AgentError } from "./agent.errors";
import { AgentCommandFinishedEvent } from "./agent.events";
import { AgentJobExecutor } from "./agent-job.executor";

const worker = (name: string, busy = false, types = ["report.build"]) => ({
  name,
  state: "running",
  health: { ok: true, busy },
  manifest: { commands: types.map(type => ({ type })) },
});

const command = (patch: object) => ({
  id: "j1.0",
  agentId: "a1",
  type: "worker.command",
  worker: "report",
  args: { worker: "report", type: "report.build", args: { jobId: "j1" } },
  status: "done",
  ok: true,
  result: { rows: 1 },
  error: null,
  progress: null,
  progressText: null,
  ...patch,
});

describe("AgentJobExecutor", () => {
  const job = {
    jobId: "j1",
    queue: "reports",
    attempt: 0,
    data: { id: 1 },
    target: { type: "report.build", worker: "report" },
  };

  const setup = (agents: { id: string; online: boolean; workers: any[] }[]) => {
    const api = {
      all: sinon.stub().resolves(agents),
      isOnline: (a: { online: boolean }) => a.online,
      workers: (a: { workers: any[] }) => a.workers,
      workerCommand: sinon.stub().resolves({ id: "j1.0" }),
    };
    const bus = new EventBus();

    return { api, bus, executor: new AgentJobExecutor(api as any, bus) };
  };

  it("команда — свободному воркеру на связи, объявившему тип; id — задача и попытка", async () => {
    const { api, executor } = setup([
      { id: "off", online: false, workers: [worker("report")] },
      { id: "busy", online: true, workers: [worker("report", true)] },
      {
        id: "other",
        online: true,
        workers: [worker("report", false, ["x.y"])],
      },
      { id: "free", online: true, workers: [worker("report")] },
    ]);

    const update = await executor.dispatch(job);

    expect(api.workerCommand.firstCall.args).to.deep.equal([
      "free",
      "report",
      "report.build",
      { jobId: "j1", data: { id: 1 }, files: undefined },
      { id: "j1.0", job: true },
    ]);
    expect(update).to.include({
      kind: "progress",
      agentId: "free",
      workId: "j1.0",
    });
  });

  it("нет подходящего воркера — повторяемая NO_AGENT; data не по схеме — без повторов", async () => {
    const none = setup([{ id: "a", online: true, workers: [worker("other")] }]);

    await none.executor.dispatch(job).then(
      () => expect.fail("должно было упасть"),
      (err: JobError) =>
        expect(err).to.include({ code: "NO_AGENT", retryable: true }),
    );

    const invalid = setup([
      { id: "a", online: true, workers: [worker("report")] },
    ]);

    invalid.api.workerCommand.rejects(
      AgentError.COMMAND_INVALID({
        reason: "/id must be string",
      }) as HttpException,
    );
    await invalid.executor.dispatch(job).then(
      () => expect.fail("должно было упасть"),
      (err: JobError) => {
        expect(err).to.include({
          code: AgentError.codes.COMMAND_INVALID,
          retryable: false,
        });
        expect(err.message).to.include("/id must be string");
      },
    );
  });

  it("итог команды задачи — обновление задачи: done, failed, cancelled", async () => {
    const { bus, executor } = setup([]);
    const updates: any[] = [];

    executor.onUpdate(async u => {
      updates.push(u);
    });
    await bus.emitAsync(new AgentCommandFinishedEvent(command({}) as any));
    await bus.emitAsync(
      new AgentCommandFinishedEvent(
        command({ ok: false, error: { code: "BOOM", message: "сбой" } }) as any,
      ),
    );
    await bus.emitAsync(
      new AgentCommandFinishedEvent(
        command({
          ok: false,
          error: { code: "CANCELLED", message: "" },
        }) as any,
      ),
    );
    // Команда не задачи (без jobId) — не обновление.
    await bus.emitAsync(
      new AgentCommandFinishedEvent(
        command({ args: { worker: "report" } }) as any,
      ),
    );

    expect(updates.map(u => u.kind)).to.deep.equal([
      "done",
      "failed",
      "cancelled",
    ]);
    expect(updates[0]).to.include({
      jobId: "j1",
      workId: "j1.0",
      agentId: "a1",
    });
    expect(updates[1].error).to.deep.equal({ code: "BOOM", message: "сбой" });
  });
});
