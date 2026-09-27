import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { createMockEventBus, uuid, uuid2, uuid3 } from "../../test/helpers";
import {
  WgNodeLiveStatsEvent,
  WgOverviewUpdatedEvent,
  WgPeersLiveStatsEvent,
} from "./events";
import { WgLiveStore } from "./wg-live-store.service";
import { tickTime, WgStatsIngestService } from "./wg-stats-ingest.service";

describe("WgStatsIngestService", () => {
  const nodeId = uuid();
  const ifaceId = uuid2();
  const peerId = uuid3();
  const node = { id: nodeId, configVersion: 1 } as any;
  const iface = { id: ifaceId, nodeId, name: "wg0" } as any;
  const peer = {
    id: peerId,
    interfaceId: ifaceId,
    publicKey: "PUB",
    userId: null,
    rxBytesTotal: 0,
    txBytesTotal: 0,
  } as any;

  let service: WgStatsIngestService;
  let live: WgLiveStore;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let samples: { insert: sinon.SinonStub };
  let watched: boolean;
  let metrics: { createAndSave: sinon.SinonStub };
  let peerService: { applyStatsUpdates: sinon.SinonStub };
  let overview: { rebuildLiveOverview: sinon.SinonStub };

  beforeEach(() => {
    live = new WgLiveStore();
    eventBus = createMockEventBus();
    samples = { insert: sinon.stub().resolves({}) };
    watched = false;
    metrics = { createAndSave: sinon.stub().resolves({}) };
    peerService = { applyStatsUpdates: sinon.stub().resolves() };
    overview = {
      rebuildLiveOverview: sinon.stub().resolves({ rxBps: 0, txBps: 0 }),
    };
    service = new WgStatsIngestService(
      { findForNode: sinon.stub().resolves([iface]) } as any,
      { find: sinon.stub().resolves([peer]) } as any,
      peerService as any,
      samples as any,
      metrics as any,
      live,
      overview as any,
      { isWatched: async () => watched } as any,
      eventBus as any,
    );
  });

  const report = (rx: number, tx: number, handshakeAgoSec = 10) => ({
    interfaces: [
      {
        name: "wg0",
        peers: [
          {
            publicKey: "PUB",
            rxBytes: rx,
            txBytes: tx,
            lastHandshake: Math.floor(Date.now() / 1000) - handshakeAgoSec,
            endpoint: "5.6.7.8:12345",
          },
        ],
      },
    ],
  });

  it("первый ingest пишет сэмпл и обновляет пира", async () => {
    await service.ingest(node, report(1000, 500));

    expect(samples.insert.calledOnce).to.be.true;

    const [sample] = samples.insert.firstCall.args[0];

    expect(sample.peerId).to.equal(peerId);
    expect(sample.rxTotal).to.equal(1000);
    expect(sample.online).to.be.true;
    expect(peerService.applyStatsUpdates.calledOnce).to.be.true;
  });

  it("повторный ingest в течение минуты не пишет новый сэмпл", async () => {
    await service.ingest(node, report(1000, 500));
    await service.ingest(node, report(2000, 900));

    expect(samples.insert.calledOnce).to.be.true;
  });

  it("live-снимок пира содержит скорость и суммы", async () => {
    await service.ingest(node, report(1000, 500));
    await service.ingest(node, report(3000, 700));

    const snapshot = await live.getJson<any>(`peer:${peerId}`);

    expect(snapshot.rxTotal).to.equal(3000);
    expect(snapshot.online).to.be.true;
    expect(snapshot.endpoint).to.equal("5.6.7.8:12345");
  });

  it("сброс счётчика wg не роняет накопленный трафик", async () => {
    await service.ingest(node, report(5000, 100));
    // Интерфейс перезапустился: счётчики начались заново.
    await service.ingest(node, report(200, 20));

    const snapshot = await live.getJson<any>(`peer:${peerId}`);

    expect(snapshot.rxTotal).to.equal(5200);
  });

  it("реплики: один пир на двух нодах — трафик суммируется, простаивающая реплика не перетирает", async () => {
    // Счётчики wg у каждой ноды свои: смешанные в одном состоянии, они
    // выглядели бы как сбросы и давали неверные суммы.
    const nodeB = { id: "22222222-2222-4222-8222-222222222222" } as any;
    const at = (rx: number, handshakeAgoSec: number, endpoint: string) => ({
      interfaces: [
        {
          name: "wg0",
          peers: [
            {
              publicKey: "PUB",
              rxBytes: rx,
              txBytes: 0,
              lastHandshake: Math.floor(Date.now() / 1000) - handshakeAgoSec,
              endpoint,
            },
          ],
        },
      ],
    });
    const total = async () =>
      (await live.getJson<any>(`peer:${peerId}`)).rxTotal as number;
    const endpoint = async () =>
      (await live.getJson<any>(`peer:${peerId}`)).endpoint as string;

    await service.ingest(node, at(1000, 5, "a:1"));
    await service.ingest(node, at(3000, 5, "a:1"));
    expect(await total()).to.equal(3000);

    await service.ingest(nodeB, at(200, 100, "b:1"));
    expect(await total()).to.equal(3000);
    expect(await endpoint()).to.equal("a:1");

    await service.ingest(nodeB, at(700, 1, "b:1"));
    expect(await total()).to.equal(3500);
    expect(await endpoint()).to.equal("b:1");

    await service.ingest(node, at(3000, 60, "a:1"));
    expect(await total()).to.equal(3500);
    expect(await endpoint()).to.equal("b:1");
  });

  it("шлёт live-событие пира и overview", async () => {
    await service.ingest(node, report(1000, 500));

    const events = eventBus.emit.getCalls().map(call => call.args[0]);

    expect(events.some(event => event instanceof WgPeersLiveStatsEvent)).to.be
      .true;
    expect(events.some(event => event instanceof WgOverviewUpdatedEvent)).to.be
      .true;
  });

  describe("тики агента", () => {
    const tick = (
      rx: number,
      fields: { seq?: number; collectedAt?: number; sentAt?: number },
    ) => ({ ...report(rx, 0), bootId: "boot-1", ...fields });

    it("время сбора — по задержке доставки на часах агента, не по их показаниям", () => {
      // Часы агента отстают на час: момент сбора всё равно «сейчас − 3 с».
      const now = 1_800_000_000_000;
      const agentNow = now - 3_600_000;

      expect(
        tickTime({ collectedAt: agentNow - 3000, sentAt: agentNow }, now),
      ).to.equal(now - 3000);
      expect(tickTime({}, now)).to.equal(now);
    });

    it("повтор тика того же запуска отбрасывается, новый запуск — принимается", async () => {
      const at = Date.now();

      expect(
        await service.ingest(
          node,
          tick(1000, { seq: 5, collectedAt: at, sentAt: at }),
        ),
      ).to.deep.equal({ duplicate: false, backfill: false });
      expect(
        (
          await service.ingest(
            node,
            tick(9000, { seq: 5, collectedAt: at, sentAt: at }),
          )
        ).duplicate,
      ).to.equal(true);
      expect((await live.getJson<any>(`peer:${peerId}`)).rxTotal).to.equal(
        1000,
      );

      const restarted = {
        ...tick(1500, { seq: 1, collectedAt: at, sentAt: at }),
        bootId: "boot-2",
      };

      expect((await service.ingest(node, restarted)).duplicate).to.equal(false);
    });

    it("досылка после разрыва: трафик учтён, живых событий и точек ряда нет", async () => {
      const agentNow = Date.now();

      await service.ingest(
        node,
        tick(1000, {
          seq: 1,
          collectedAt: agentNow - 120_000,
          sentAt: agentNow,
        }),
      );
      eventBus.emit.resetHistory();

      const result = await service.ingest(
        node,
        tick(4000, {
          seq: 2,
          collectedAt: agentNow - 60_000,
          sentAt: agentNow,
        }),
      );

      expect(result.backfill).to.equal(true);
      expect((await live.getJson<any>(`peer:${peerId}`)).rxTotal).to.equal(
        4000,
      );
      expect(eventBus.emit.called).to.equal(false);
      expect(await live.listRecent(`win:peer:${peerId}`)).to.deep.equal([]);
    });

    it("скорость — по моментам сбора тиков, короткий ряд копит точки", async () => {
      const at = Date.now();

      await service.ingest(
        node,
        tick(0, { seq: 1, collectedAt: at - 2000, sentAt: at }),
      );
      await service.ingest(
        node,
        tick(4000, { seq: 2, collectedAt: at, sentAt: at }),
      );

      const window = await live.listRecent<any>(`win:peer:${peerId}`);

      expect(window).to.have.length(2);
      expect(window[1].rxBps).to.be.within(1900, 2100);
      expect(await live.listRecent(`win:node:${nodeId}`)).to.have.length(2);
    });

    it("при открытой админке события уходят каждый тик, без неё — при изменении", async () => {
      const at = Date.now();
      const nodeEvents = () =>
        eventBus.emit
          .getCalls()
          .filter(call => call.args[0] instanceof WgNodeLiveStatsEvent).length;

      await service.ingest(
        node,
        tick(1000, { seq: 1, collectedAt: at - 2000, sentAt: at }),
      );
      const before = nodeEvents();

      // Скорость не изменилась: без зрителей события нет.
      await service.ingest(
        node,
        tick(1000, { seq: 2, collectedAt: at - 1000, sentAt: at }),
      );
      expect(nodeEvents()).to.equal(before);

      watched = true;
      await service.ingest(
        node,
        tick(1000, { seq: 3, collectedAt: at, sentAt: at }),
      );
      expect(nodeEvents()).to.equal(before + 1);
    });
  });
});
