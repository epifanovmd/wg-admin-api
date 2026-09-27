import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { EventBus } from "../../core";
import { uuid } from "../../test/helpers";
import { EJobRunStatus, JobUpdatedEvent } from "../jobs";
import { WgProvisionListener } from "./wg-provision.listener";
import { WG_NODE_JOB_SCOPE, WG_PROVISION_QUEUE } from "./wg-provision.types";

describe("WgProvisionListener", () => {
  const nodeId = uuid();
  let eventBus: EventBus;
  let nodes: { failProvisioning: sinon.SinonStub };

  const emit = (patch: Record<string, unknown>) =>
    eventBus.emit(
      new JobUpdatedEvent({
        id: uuid(),
        queue: WG_PROVISION_QUEUE,
        status: EJobRunStatus.FAILED,
        scopeType: WG_NODE_JOB_SCOPE,
        scopeId: nodeId,
        ...patch,
      } as any),
    );

  beforeEach(() => {
    eventBus = new EventBus();
    nodes = { failProvisioning: sinon.stub().resolves() };
    new WgProvisionListener(eventBus, nodes as any).register();
  });

  it("проваленная или отменённая установка — нода в error", async () => {
    // Итог задачи приходит событием и тогда, когда catch задачи не выполнился
    // (задачу закрыл reaper после падения воркера).
    emit({});
    emit({ status: EJobRunStatus.CANCELLED });
    await new Promise(resolve => setImmediate(resolve));

    expect(nodes.failProvisioning.callCount).to.equal(2);
    expect(nodes.failProvisioning.firstCall.args[0]).to.equal(nodeId);
  });

  it("другие очереди, статусы и задачи без scope — без реакции", async () => {
    emit({ queue: "mail.send" });
    emit({ status: EJobRunStatus.RUNNING });
    emit({ status: EJobRunStatus.COMPLETED });
    emit({ scopeType: null, scopeId: null });
    await new Promise(resolve => setImmediate(resolve));

    expect(nodes.failProvisioning.called).to.be.false;
  });
});
