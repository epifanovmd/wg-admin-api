import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgAgentSyncService } from "./wg-agent-sync.service";

describe("WgAgentSyncService", () => {
  const configs = {
    state: {
      version: 3,
      nodeId: "n1",
      nodeName: "n",
      interfaces: [],
      tunnels: [],
      forwards: [],
    },
    probes: { targets: [] },
    proxies: { proxies: [] },
  };

  const make = (
    node: Record<string, unknown> | null,
    stored: Record<string, unknown>,
  ) => {
    const nodes = {
      findEntity: node
        ? sinon.stub().resolves(node)
        : sinon.stub().rejects(new Error("nf")),
      boundNodes: sinon.stub().resolves([]),
    };
    const state = { build: sinon.stub().resolves(configs) };
    const workers = {
      findConfig: sinon
        .stub()
        .callsFake(async (_a: string, worker: string, key: string) =>
          stored[`${worker}/${key}`] === undefined
            ? null
            : { data: stored[`${worker}/${key}`] },
        ),
      putConfig: sinon.stub().resolves({ version: 1 }),
    };

    return {
      service: new WgAgentSyncService(
        nodes as any,
        state as any,
        workers as any,
      ),
      workers,
      state,
    };
  };

  it("записывает только изменившиеся ключи", async () => {
    const t = make(
      { id: "n1", agentId: "a1" },
      {
        "wg/state": { ...configs.state, version: 2 },
        "wg/probes": configs.probes,
      },
    );

    await t.service.sync("n1");

    expect(
      t.workers.putConfig.getCalls().map(c => `${c.args[1]}/${c.args[2]}`),
    ).to.deep.equal(["wg/state", "socks/proxies"]);
  });

  it("нода без агента или удалённая — ничего", async () => {
    const unbound = make({ id: "n1", agentId: null }, {});

    await unbound.service.sync("n1");
    expect(unbound.state.build.called).to.equal(false);

    const gone = make(null, {});

    await gone.service.sync("n1");
    expect(gone.workers.putConfig.called).to.equal(false);
  });

  it("изменение во время сборки — ещё один проход, без параллельных", async () => {
    const t = make({ id: "n1", agentId: "a1" }, {});
    let resolve!: () => void;

    t.state.build
      .onFirstCall()
      .callsFake(() => new Promise(r => (resolve = () => r(configs))));

    const first = t.service.sync("n1");
    const second = t.service.sync("n1");

    await second;
    while (!t.state.build.called) await new Promise(r => setImmediate(r));
    resolve();
    await first;
    expect(t.state.build.callCount).to.equal(2);
  });
});
