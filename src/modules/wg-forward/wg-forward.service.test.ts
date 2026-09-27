import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2 } from "../../test/helpers";
import { WgForwardService } from "./wg-forward.service";

describe("WgForwardService: порты хоста релея", () => {
  const relayId = uuid();
  const targetId = uuid2();
  let repo: Record<string, sinon.SinonStub>;
  let live: { getJson: sinon.SinonStub; setJson: sinon.SinonStub };
  let eventBus: { emit: sinon.SinonStub };
  let service: WgForwardService;

  const body = (patch: Record<string, unknown> = {}) => ({
    name: "wg-server",
    relayNodeId: relayId,
    protocol: "udp" as any,
    listenPort: 51820,
    targetNodeId: targetId,
    targetPort: 51820,
    path: "ipip" as any,
    ...patch,
  });

  beforeEach(() => {
    live = {
      getJson: sinon.stub().resolves(null),
      setJson: sinon.stub().resolves(),
    };
    eventBus = { emit: sinon.stub() };
    repo = {
      create: sinon.stub().callsFake((data: any) => ({ ...data })),
      findOne: sinon.stub().resolves(null),
      findWithNodes: sinon.stub(),
      getRepository: sinon.stub().returns({
        save: sinon.stub().callsFake(async (e: any) => ({ ...e, id: "f1" })),
      }),
    };
    service = new WgForwardService(
      repo as any,
      {
        findEntity: sinon
          .stub()
          .callsFake(async (id: string) =>
            id === relayId
              ? { id, osInfo: { udpPorts: [51820] } }
              : { id, publicHost: "198.51.100.20" },
          ),
        markDirty: sinon.stub().resolves(),
      } as any,
      {
        nodeListenPortInUse: sinon.stub().resolves(false),
        relayForwardPortInUse: sinon.stub().resolves(false),
      } as any,
      { syncRelaySafe: sinon.stub().resolves() } as any,
      live as any,
      { transaction: (cb: any) => cb({}) } as any,
      eventBus as any,
    );
    sinon.stub(service, "get").resolves({ id: "f1" } as any);
  });

  it("включённый проброс на порт, занятый процессом хоста, — 409", async () => {
    try {
      await service.create(body());
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_FORWARD_PORT_TAKEN");
    }
  });

  it("выключенный — создаётся на занятый порт заранее", async () => {
    // Порт освободится при переключении; включение проверит агент релея
    // (откажется, пока порт занят, и применит сам, когда освободится).
    const created = await service.create(body({ enabled: false }));

    expect(created.id).to.equal("f1");
  });

  it("включение существующего проброса не блокируется устаревшим отчётом о портах", async () => {
    repo.findWithNodes.resolves({ id: "f1", ...body(), enabled: false });

    const updated = await service.update("f1", { enabled: true });

    expect(updated.id).to.equal("f1");
  });

  it("смена порта на занятый процессом хоста — 409", async () => {
    repo.findWithNodes.resolves({
      id: "f1",
      ...body({ listenPort: 51900 }),
      enabled: true,
    });

    try {
      await service.update("f1", { listenPort: 51820 });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_FORWARD_PORT_TAKEN");
    }
  });

  it("маршрут от агента: событие только при смене", async () => {
    repo.find = sinon.stub().resolves([{ id: "f1" }]);
    live.getJson.resolves("tunnel");

    await service.recordRoutes(relayId, [
      { id: "f1", activeRoute: "tunnel" as any },
    ]);
    expect(eventBus.emit.called).to.equal(false);

    await service.recordRoutes(relayId, [
      { id: "f1", activeRoute: "direct" as any },
      { id: "foreign", activeRoute: "direct" as any },
    ]);
    expect(eventBus.emit.callCount).to.equal(1);
    expect(eventBus.emit.firstCall.args[0].forward).to.deep.equal({ id: "f1" });
    expect(live.setJson.callCount).to.equal(2);
  });

  it("сохранение и удаление отправляют события", async () => {
    await service.create(body({ enabled: false }));
    expect(eventBus.emit.lastCall.args[0].forward).to.deep.equal({ id: "f1" });

    repo.findWithNodes.resolves({ id: "f1", relayNodeId: relayId });
    repo.getRepository.returns({ delete: sinon.stub().resolves() });
    await service.delete("f1");
    expect(eventBus.emit.lastCall.args[0].forwardId).to.equal("f1");
  });
});
