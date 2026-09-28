import "reflect-metadata";

import { expect } from "chai";

import { EventBus } from "../../core";
import { createMockEmitter } from "../../test/helpers";
import { JobUpdatedEvent } from "./events";
import { JobsSocketListener } from "./jobs.listener";

describe("JobsSocketListener", () => {
  const job = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "job-1",
      ownerId: "u1",
      scopeType: null,
      scopeId: null,
      ...overrides,
    }) as any;

  it("в комнату задачи, в комнату scope и владельцу (его список задач)", () => {
    const bus = new EventBus();
    const emitter = createMockEmitter();

    new JobsSocketListener(bus, emitter as any).register();
    bus.emit(
      new JobUpdatedEvent(job({ scopeType: "workspace", scopeId: "w1" })),
    );

    expect(emitter.toRoom.firstCall.args.slice(0, 2)).to.deep.equal([
      "job_job-1",
      "job:updated",
    ]);
    expect(emitter.toRoom.secondCall.args[0]).to.equal("workspace_w1");
    expect(emitter.toUser.firstCall.args.slice(0, 2)).to.deep.equal([
      "u1",
      "job:updated",
    ]);
  });

  it("без scope — владельцу", () => {
    const bus = new EventBus();
    const emitter = createMockEmitter();

    new JobsSocketListener(bus, emitter as any).register();
    bus.emit(new JobUpdatedEvent(job()));

    expect(emitter.toRoom.calledOnce).to.be.true;
    expect(emitter.toUser.firstCall.args.slice(0, 2)).to.deep.equal([
      "u1",
      "job:updated",
    ]);
  });
});
