import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { WgStatsQueryService } from "./wg-stats-query.service";

const actor = (permissions: string[]) =>
  ({ userId: "u1", sessionId: "s1", roles: [], permissions }) as any;

describe("WgStatsQueryService: доступ к статистике нод", () => {
  let nodes: { findOne: sinon.SinonStub };
  let metrics: { queryRange: sinon.SinonStub };
  let overview: Record<string, sinon.SinonStub>;
  let links: { forNode: sinon.SinonStub };
  let service: WgStatsQueryService;

  beforeEach(() => {
    nodes = { findOne: sinon.stub().resolves(null) };
    metrics = { queryRange: sinon.stub().resolves([]) };
    links = { forNode: sinon.stub().resolves([]) };
    overview = {
      canViewGlobal: sinon
        .stub()
        .callsFake(a => a.permissions.includes("wg:stats:view")),
      canViewOwn: sinon
        .stub()
        .callsFake(a => a.permissions.includes("wg:stats:view:own")),
      getNodeLive: sinon.stub().resolves(null),
      getSpeedWindow: sinon.stub().resolves([]),
    };
    service = new WgStatsQueryService(
      {} as any,
      {} as any,
      metrics as any,
      {} as any,
      nodes as any,
      overview as any,
      links as any,
      {} as any,
    );
  });

  const expectForbidden = async (run: () => Promise<unknown>) => {
    try {
      await run();
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_STATS_FORBIDDEN");
    }
  };

  it("вся статистика — любая нода без запроса к БД", async () => {
    const all = actor(["wg:stats:view"]);

    await service.currentNode(all, "n1");
    await service.nodeWindow(all, "n1");
    await service.nodeLinks(all, "n1");

    expect(nodes.findOne.called).to.be.false;
  });

  it("область own — только своя нода (владелец или создатель)", async () => {
    const own = actor(["wg:stats:view:own"]);

    nodes.findOne.resolves({ ownerId: null, createdById: "u1" });
    await service.currentNode(own, "n1");
    await service.nodeWindow(own, "n1");
    await service.nodeLinks(own, "n1");

    nodes.findOne.resolves({ ownerId: "u2", createdById: null });
    await expectForbidden(() => service.currentNode(own, "n1"));
    await expectForbidden(() => service.nodeLinks(own, "n1"));
  });

  it("без права статистики — 403", async () => {
    nodes.findOne.resolves({ ownerId: "u1", createdById: null });

    await expectForbidden(() => service.nodeWindow(actor([]), "n1"));
  });

  it("метрики ноды: право просмотра нод — все или своя", async () => {
    const from = new Date(Date.now() - 3600_000);
    const to = new Date();

    await service.nodeMetrics(actor(["wg:node:view"]), "n1", from, to);
    expect(nodes.findOne.called).to.be.false;

    nodes.findOne.resolves({ ownerId: "u1", createdById: null });
    await service.nodeMetrics(actor(["wg:node:view:own"]), "n1", from, to);

    nodes.findOne.resolves({ ownerId: "u2", createdById: null });
    await expectForbidden(() =>
      service.nodeMetrics(actor(["wg:node:view:own"]), "n1", from, to),
    );
    await expectForbidden(() => service.nodeMetrics(actor([]), "n1", from, to));
  });
});
