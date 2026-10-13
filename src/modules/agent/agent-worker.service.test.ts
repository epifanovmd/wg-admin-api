import "reflect-metadata";

import { schemaProblems } from "agent-sdk/server";
import { expect } from "chai";
import sinon from "sinon";

import { HttpException } from "../../core";
import { AgentWorkerService } from "./agent-worker.service";

const agent = {
  id: "a1",
  workers: [
    {
      name: "wg",
      manifest: {
        version: "1.0.0",
        configs: [
          {
            key: "state",
            schema: {
              type: "object",
              required: ["peers"],
              properties: { peers: { type: "array" } },
            },
          },
        ],
        routes: [
          {
            method: "POST",
            path: "/peers/{id}",
            request: { type: "object", required: ["name"] },
          },
        ],
      },
    },
  ],
};

const setup = () => {
  const agents = {
    getAgent: sinon.stub().resolves(agent),
    setConfig: sinon.stub().callsFake(async (agentId, worker, key, data) => ({
      agentId,
      worker,
      key,
      version: 7,
      data,
      updatedAt: 1,
    })),
    getConfig: sinon.stub().resolves(undefined),
    configStatus: sinon.stub().resolves([
      {
        agentId: "a1",
        worker: "wg",
        key: "state",
        version: 7,
        state: "pending",
      },
    ]),
    fetch: sinon.stub().callsFake(async () => new Response("{}")),
  };
  const runtime = {
    agents,
    audit: sinon.stub(),
    act: sinon
      .stub()
      .callsFake(
        (
          _actor: unknown,
          _id: unknown,
          _name: unknown,
          _d: unknown,
          fn: () => unknown,
        ) => fn(),
      ),
    schemaProblems: (...args: Parameters<typeof schemaProblems>) =>
      schemaProblems(...args),
  };
  const access = { require: sinon.stub().resolves() };
  const store = {
    withActor: sinon
      .stub()
      .callsFake((_actor: unknown, fn: () => unknown) => fn()),
  };
  const service = new AgentWorkerService(
    runtime as any,
    access as any,
    store as any,
  );

  return { service, runtime, agents, store };
};

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (err: unknown) => (err instanceof HttpException ? err.code : String(err)),
  );

describe("AgentWorkerService: проверка по манифесту и аудит", () => {
  const user = { userId: "u1", roles: [], permissions: [] };

  it("настройки не по схеме ключа — 400 CONFIG_INVALID, запись не идёт", async () => {
    const { service, agents, runtime } = setup();

    expect(
      await codeOf(service.putConfig("a1", "wg", "state", { peers: 1 })),
    ).to.equal("AGENT_CONFIG_INVALID");
    expect(agents.setConfig.called).to.equal(false);
    expect(runtime.audit.called).to.equal(false);
  });

  it("запись настроек — от имени пользователя (actor) и в аудит с версией", async () => {
    const { service, store, runtime } = setup();

    await service.setConfig(user, "a1", "wg", "state", { peers: [] });

    expect(store.withActor.firstCall.args[0]).to.equal("u1");
    expect(runtime.audit.firstCall.args).to.deep.equal([
      "config.set",
      "u1",
      "a1",
      { worker: "wg", key: "state", version: 7 },
    ]);
  });

  it("системная запись — без автора, в аудит с actor null", async () => {
    const { service, store, runtime } = setup();

    await service.putConfig("a1", "wg", "state", { peers: [] });

    expect(store.withActor.firstCall.args[0]).to.equal(null);
    expect(runtime.audit.firstCall.args[1]).to.equal(null);
  });

  it("тело запроса не по схеме маршрута или не JSON — 400 REQUEST_INVALID", async () => {
    const { service, agents } = setup();

    expect(
      await codeOf(
        service.request("a1", "wg", "/peers/p1", {
          method: "POST",
          body: { other: 1 },
        }),
      ),
    ).to.equal("AGENT_REQUEST_INVALID");
    expect(
      await codeOf(
        service.fetch(
          user,
          "a1",
          "wg",
          { method: "POST", path: "/peers/p1", body: "{" },
          new AbortController().signal,
        ),
      ),
    ).to.equal("AGENT_REQUEST_INVALID");
    expect(agents.fetch.called).to.equal(false);
  });

  it("изменяющий запрос — в аудит, чтение — нет", async () => {
    const { service, runtime } = setup();
    const signal = new AbortController().signal;

    await service.fetch(user, "a1", "wg", { path: "/status" }, signal);
    await service.fetch(
      user,
      "a1",
      "wg",
      { method: "POST", path: "/peers/p1", body: '{"name":"x"}' },
      signal,
    );

    expect(runtime.audit.callCount).to.equal(1);
    expect(runtime.audit.firstCall.args).to.deep.equal([
      "fetch",
      "u1",
      "a1",
      { worker: "wg", method: "POST", path: "/peers/p1" },
    ]);
  });

  it("перезапуск воркера — действие от имени пользователя", async () => {
    const { service, runtime } = setup();

    (runtime.agents as any).restartWorker = sinon
      .stub()
      .resolves({ deferred: false });
    await service.restartAs("u1", "a1", "wg", true);

    expect(runtime.act.firstCall.args.slice(0, 4)).to.deep.equal([
      "u1",
      "a1",
      "worker.restart",
      { name: "wg", force: true },
    ]);
  });
});
