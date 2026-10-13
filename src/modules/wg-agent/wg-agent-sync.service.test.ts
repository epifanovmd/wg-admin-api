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

  const make = (node: Record<string, unknown> | null) => {
    const nodes = {
      findEntity: node
        ? sinon.stub().resolves(node)
        : sinon.stub().rejects(new Error("nf")),
      boundNodes: sinon.stub().resolves([]),
    };
    const state = { build: sinon.stub().resolves(configs) };
    const agents = { setConfig: sinon.stub().resolves(1) };

    return {
      service: new WgAgentSyncService(
        nodes as any,
        state as any,
        agents as any,
      ),
      agents,
      state,
    };
  };

  it("пишет все ключи только при изменении значения", async () => {
    const t = make({ id: "n1", agentId: "a1" });

    await t.service.sync("n1");

    expect(
      t.agents.setConfig
        .getCalls()
        .map(c => [c.args[0], `${c.args[1]}/${c.args[2]}`, c.args[4]]),
    ).to.deep.equal([
      ["a1", "wg/state", { onlyIfChanged: true }],
      ["a1", "wg/probes", { onlyIfChanged: true }],
      ["a1", "socks/proxies", { onlyIfChanged: true }],
    ]);
    expect(t.agents.setConfig.firstCall.args[3]).to.deep.equal(configs.state);
  });

  it("отказ в одном ключе не мешает остальным", async () => {
    const t = make({ id: "n1", agentId: "a1" });

    t.agents.setConfig.onFirstCall().rejects(new Error("CONFIG_INVALID"));
    await t.service.sync("n1");
    expect(t.agents.setConfig.callCount).to.equal(3);
  });

  it("нода без агента или удалённая — ничего", async () => {
    const unbound = make({ id: "n1", agentId: null });

    await unbound.service.sync("n1");
    expect(unbound.state.build.called).to.equal(false);

    const gone = make(null);

    await gone.service.sync("n1");
    expect(gone.agents.setConfig.called).to.equal(false);
  });

  it("изменение во время сборки — ещё один проход, без параллельных", async () => {
    const t = make({ id: "n1", agentId: "a1" });
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
