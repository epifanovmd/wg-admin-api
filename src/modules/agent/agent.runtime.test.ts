import "reflect-metadata";

import { expect } from "chai";
import { EventEmitter } from "events";
import sinon from "sinon";

import { agentConfig } from "./agent.config";
import { AgentRuntime } from "./agent.runtime";
import {
  AgentActionAuditedEvent,
  AgentActionFinishedEvent,
  AgentAlertChangedEvent,
  AgentEventReceivedEvent,
  AgentReleaseChangedEvent,
  AgentUpdatedEvent,
} from "./events";

const manifestAgent = (patch: Record<string, unknown> = {}): any => ({
  id: "a1",
  name: "node-1",
  labels: {},
  online: true,
  revoked: false,
  enrolledAt: 1,
  lastSeenAt: 5,
  statusAt: 4,
  workers: [
    {
      name: "wg",
      manifest: {
        version: "1.0.0",
        events: [
          {
            type: "wg.up",
            schema: { type: "object", required: ["iface"] },
          },
        ],
      },
    },
  ],
  ...patch,
});

const setup = (agent = manifestAgent()) => {
  const emitted: object[] = [];
  const eventBus = { emit: (event: object) => emitted.push(event) };
  const history = { saveEvent: sinon.stub().resolves(true) };
  const enrollment = { takeSource: () => null };
  const runtime = new AgentRuntime(
    {} as any,
    enrollment as any,
    history as any,
    {} as any,
    eventBus as any,
  );
  const agents = Object.assign(new EventEmitter(), {
    getAgent: sinon.stub().resolves(agent),
    configStatus: sinon.stub().resolves([]),
  });

  (runtime as any)._agents = agents;
  (runtime as any).bridge(agents);

  return { runtime, agents, emitted, history };
};

const event = (data: unknown) => ({
  id: "m1",
  agentId: "a1",
  worker: "wg",
  type: "wg.up",
  data,
  at: 1,
  receivedAt: 2,
});

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe("AgentRuntime", () => {
  afterEach(() => sinon.restore());

  it("событие не по схеме (log): обработчики вызываются, в истории — замечания", async () => {
    const { runtime, emitted, history } = setup();
    const handler = sinon.stub().resolves();

    runtime.onWorkerEvent(handler);
    await (runtime as any).handleWorkerEvent(event({}));

    expect(handler.calledOnce).to.equal(true);
    expect(history.saveEvent.firstCall.args[1]).to.have.length(1);
    const received = emitted.find(
      e => e instanceof AgentEventReceivedEvent,
    ) as AgentEventReceivedEvent;

    expect(received.event.problems).to.have.length(1);
  });

  it("событие не по схеме (reject): обработчикам не передаётся, в истории остаётся", async () => {
    sinon.stub(agentConfig, "validateEvents").value("reject");

    const { runtime, history } = setup();
    const handler = sinon.stub().resolves();

    runtime.onWorkerEvent(handler);
    await (runtime as any).handleWorkerEvent(event({}));
    await (runtime as any).handleWorkerEvent(event({ iface: "wg0" }));

    expect(handler.callCount).to.equal(1);
    expect(history.saveEvent.callCount).to.equal(2);
  });

  it("проблемы: первый раз — без событий, дальше — начавшиеся и закончившиеся", async () => {
    const { agents, emitted } = setup();
    const down = manifestAgent({
      status: { workers: [{ name: "wg", state: "backoff" }] },
    });

    agents.emit("agent", manifestAgent());
    agents.emit("agent", down);
    agents.emit("agent", manifestAgent());
    await settle();

    const alerts = emitted
      .filter(e => e instanceof AgentAlertChangedEvent)
      .map(e => (e as AgentAlertChangedEvent).alert);

    expect(alerts.map(a => [a.key, a.active])).to.deep.equal([
      ["workerDown:wg", true],
      ["workerDown:wg", false],
    ]);

    const updated = emitted.filter(
      e => e instanceof AgentUpdatedEvent,
    ) as AgentUpdatedEvent[];

    expect(updated.map(e => e.agent.alerts.length)).to.deep.equal([0, 1, 0]);
  });

  it("новая версия агента, найденная агентами, — событие при росте update.latest", async () => {
    const { agents, emitted } = setup();
    const withLatest = (latest: string) =>
      manifestAgent({ update: { latest, checkedAt: 1 } });

    agents.emit("agent", withLatest("2.1.0"));
    agents.emit("agent", withLatest("2.0.5"));
    agents.emit("agent", withLatest("2.2.0"));
    await settle();

    expect(
      emitted
        .filter(e => e instanceof AgentReleaseChangedEvent)
        .map(e => (e as AgentReleaseChangedEvent).release),
    ).to.deep.equal([
      { version: "2.1.0", from: "agent:node-1" },
      { version: "2.2.0", previous: "2.1.0", from: "agent:node-1" },
    ]);
  });

  it("действие: аудит до вызова, автор — в итоге действия", async () => {
    const { runtime, agents, emitted } = setup();

    await runtime.act(
      "u1",
      "a1",
      "worker.restart",
      { name: "wg" },
      async () => {
        agents.emit("action", {
          id: "x1",
          agentId: "a1",
          name: "worker.restart",
          status: "done",
          createdAt: 1,
          finishedAt: 2,
        });

        return { deferred: false };
      },
    );

    const audited = emitted.find(
      e => e instanceof AgentActionAuditedEvent,
    ) as AgentActionAuditedEvent;
    const finished = emitted.find(
      e => e instanceof AgentActionFinishedEvent,
    ) as AgentActionFinishedEvent;

    expect([audited.action, audited.actorId, audited.target]).to.deep.equal([
      "worker.restart",
      "u1",
      "a1",
    ]);
    expect(finished.action.actor).to.equal("u1");
  });

  it("отложенное действие: автор — по actionId, когда итог придёт позже", async () => {
    const { runtime, agents, emitted } = setup();

    await runtime.act(
      "u1",
      "a1",
      "worker.update",
      { name: "wg" },
      async () => ({
        deferred: true,
        pending: "update",
        actionId: "x2",
      }),
    );
    agents.emit("action", {
      id: "x2",
      agentId: "a1",
      name: "worker.update",
      status: "done",
      createdAt: 1,
      finishedAt: 2,
      deferred: true,
    });

    const finished = emitted.find(
      e => e instanceof AgentActionFinishedEvent,
    ) as AgentActionFinishedEvent;

    expect(finished.action).to.include({ actor: "u1", deferred: true });
  });
});
