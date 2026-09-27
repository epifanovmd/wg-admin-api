import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import { WgMeshService } from "./wg-mesh.service";

describe("WgMeshService", () => {
  const a = uuid();
  const b = uuid2();
  const c = "33333333-3333-4333-8333-333333333333";
  let store: Map<string, unknown>;
  let service: WgMeshService;
  let eventBus: { emit: sinon.SinonStub };

  beforeEach(() => {
    store = new Map();
    eventBus = { emit: sinon.stub() };
    service = new WgMeshService(
      {
        setJson: sinon.stub().callsFake(async (k: string, v: unknown) => {
          store.set(k, v);
        }),
        getJson: sinon
          .stub()
          .callsFake(async (k: string) => store.get(k) ?? null),
      } as any,
      {
        find: sinon.stub().resolves([
          { id: a, name: "edge", publicHost: "192.0.2.30" },
          { id: b, name: "relay", publicHost: "198.51.100.10" },
          { id: c, name: "fra", publicHost: null },
        ]),
      } as any,
      eventBus as any,
    );
  });

  it("матрица: ноды и измерения «откуда → куда», себя и чужие id не пишет", async () => {
    await service.recordProbes(a, [
      { nodeId: b, rttMs: 61.2, lossPercent: 0 },
      { nodeId: a, rttMs: 0, lossPercent: 0 },
    ]);

    const matrix = await service.matrix();

    expect(matrix.nodes.map(node => node.name)).to.deep.equal([
      "edge",
      "relay",
      "fra",
    ]);
    expect(matrix.cells).to.have.length(1);
    // Свежая матрица уходит событием сразу после записи проб.
    expect(eventBus.emit.firstCall.args[0].matrix).to.deep.equal(matrix);
    expect(matrix.cells[0]).to.include({
      fromNodeId: a,
      toNodeId: b,
      rttMs: 61.2,
      lossPercent: 0,
    });
  });

  it("цели проверки для ноды — остальные ноды с publicHost", async () => {
    expect(await service.probeTargetsFor(a)).to.deep.equal([
      { nodeId: b, host: "198.51.100.10" },
    ]);
  });
});
