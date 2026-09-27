import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import {
  linkHealthStatus,
  WgLinkHealthService,
} from "./wg-link-health.service";

describe("linkHealthStatus", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const at = (ageMs: number) => new Date(now - ageMs).toISOString();

  it("по потерям и свежести пробы", () => {
    expect(linkHealthStatus(null, now)).to.equal("unknown");
    expect(
      linkHealthStatus({ rttMs: 40, lossPercent: 0, ts: at(90_000) }, now),
    ).to.equal("unknown");
    expect(
      linkHealthStatus({ rttMs: null, lossPercent: 100, ts: at(0) }, now),
    ).to.equal("down");
    expect(
      linkHealthStatus({ rttMs: 40, lossPercent: 33.3, ts: at(0) }, now),
    ).to.equal("degraded");
    expect(
      linkHealthStatus({ rttMs: 40, lossPercent: 0, ts: at(5_000) }, now),
    ).to.equal("ok");
  });
});

describe("WgLinkHealthService", () => {
  const relayId = uuid();
  const targetId = uuid2();
  const link = {
    id: "11111111-1111-4111-8111-111111111111",
    relayNodeId: relayId,
    targetNodeId: targetId,
    tunnelIndex: 3,
  };
  let store: Map<string, unknown>;
  let service: WgLinkHealthService;
  let eventBus: { emit: sinon.SinonStub };

  beforeEach(() => {
    store = new Map();
    eventBus = { emit: sinon.stub() };
    service = new WgLinkHealthService(
      {
        setJson: sinon.stub().callsFake(async (k: string, v: unknown) => {
          store.set(k, v);
        }),
        getJson: sinon
          .stub()
          .callsFake(async (k: string) => store.get(k) ?? null),
      } as any,
      { linksForNode: sinon.stub().resolves([link]) } as any,
      {
        find: sinon.stub().resolves([
          { id: relayId, name: "relay" },
          { id: targetId, name: "edge" },
        ]),
      } as any,
      eventBus as any,
    );
  });

  it("проба туннеля wgt3 с релея попадает в линк; цель видит его с ролью target", async () => {
    await service.recordProbes(relayId, [
      { name: "wgt3", rttMs: 42.5, lossPercent: 0 },
      { name: "wg0", rttMs: 1, lossPercent: 0 },
    ]);

    const [health] = await service.forNode(targetId);

    expect(health).to.include({
      linkId: link.id,
      role: "target",
      counterpartNodeId: relayId,
      counterpartName: "relay",
      tunnelName: "wgt3",
      rttMs: 42.5,
      lossPercent: 0,
      status: "ok",
    });
  });

  it("без проб — статус unknown", async () => {
    const [health] = await service.forNode(relayId);

    expect(health.role).to.equal("relay");
    expect(health.counterpartName).to.equal("edge");
    expect(health.status).to.equal("unknown");
    expect(health.rttMs).to.equal(null);
  });

  it("пробы туннелей — событие с обеими сторонами линка; чужие туннели — без события", async () => {
    await service.recordProbes(relayId, [
      { name: "wg0", rttMs: 1, lossPercent: 0 },
    ]);
    expect(eventBus.emit.called).to.equal(false);

    await service.recordProbes(relayId, [
      { name: "wgt3", rttMs: 42.5, lossPercent: 0 },
    ]);
    expect(eventBus.emit.firstCall.args[0].nodeIds).to.have.members([
      relayId,
      targetId,
    ]);
  });
});
