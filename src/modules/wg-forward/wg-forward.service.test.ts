import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2, uuid3 } from "../../test/helpers";
import { WgForwardService } from "./wg-forward.service";

const admin = { userId: uuid(), roles: ["admin"], permissions: ["*"] } as any;
/** Только свои пробросы; ноды — все. */
const tenant = {
  userId: uuid3(),
  roles: ["user"],
  permissions: [
    "wg:node:view",
    "wg:forward:create",
    "wg:forward:view:own",
    "wg:forward:update:own",
  ],
} as any;

describe("WgForwardService: порты хоста релея", () => {
  const relayId = uuid();
  const targetId = uuid2();
  let repo: Record<string, sinon.SinonStub>;
  let live: { getJson: sinon.SinonStub; setJson: sinon.SinonStub };
  let eventBus: { emit: sinon.SinonStub };
  let service: WgForwardService;
  let nodes: Record<string, sinon.SinonStub>;

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
    nodes = {
      findFor: sinon.stub().resolves({}),
      findEntity: sinon
        .stub()
        .callsFake(async (id: string) =>
          id === relayId
            ? { id, osInfo: { udpPorts: [51820] } }
            : { id, publicHost: "198.51.100.20" },
        ),
      markDirty: sinon.stub().resolves(),
    };
    service = new WgForwardService(
      repo as any,
      nodes as any,
      {
        nodeListenPortInUse: sinon.stub().resolves(false),
        relayForwardPortInUse: sinon.stub().resolves(false),
      } as any,
      { syncRelaySafe: sinon.stub().resolves() } as any,
      live as any,
      { transaction: (cb: any) => cb({}) } as any,
      eventBus as any,
    );
    sinon.stub(service as any, "_dto").resolves({ id: "f1" } as any);
  });

  it("включённый проброс на порт, занятый процессом хоста, — 409", async () => {
    try {
      await service.create(admin, body());
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_FORWARD_PORT_TAKEN");
    }
  });

  it("выключенный — создаётся на занятый порт заранее", async () => {
    // Порт освободится при переключении; включение проверит агент релея
    // (откажется, пока порт занят, и применит сам, когда освободится).
    const created = await service.create(admin, body({ enabled: false }));

    expect(created.id).to.equal("f1");
  });

  it("включение существующего проброса не блокируется устаревшим отчётом о портах", async () => {
    repo.findWithNodes.resolves({ id: "f1", ...body(), enabled: false });

    const updated = await service.update(admin, "f1", { enabled: true });

    expect(updated.id).to.equal("f1");
  });

  it("смена порта на занятый процессом хоста — 409", async () => {
    repo.findWithNodes.resolves({
      id: "f1",
      ...body({ listenPort: 51900 }),
      enabled: true,
    });

    try {
      await service.update(admin, "f1", { listenPort: 51820 });
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
    await service.create(admin, body({ enabled: false }));
    expect(eventBus.emit.lastCall.args[0].forward).to.deep.equal({ id: "f1" });

    repo.findWithNodes.resolves({ id: "f1", relayNodeId: relayId });
    repo.getRepository.returns({ delete: sinon.stub().resolves() });
    await service.delete(admin, "f1");
    expect(eventBus.emit.lastCall.args[0].forwardId).to.equal("f1");
  });

  describe("область «все / свои»", () => {
    const expectCode = async (run: () => Promise<unknown>, code: string) => {
      try {
        await run();
        expect.fail("должно было упасть");
      } catch (err: any) {
        expect(err.code).to.equal(code);
      }
    };

    it("create: создатель — автор; релей и цель проверяются на видимость", async () => {
      await service.create(tenant, body({ enabled: false }));

      expect(repo.create.firstCall.args[0]).to.include({
        createdById: tenant.userId,
        ownerId: null,
      });
      expect(nodes.findFor.getCalls().map(call => call.args[1])).to.deep.equal([
        relayId,
        targetId,
      ]);

      nodes.findFor
        .withArgs(tenant, relayId)
        .rejects(Object.assign(new Error("nf"), { code: "WG_NODE_NOT_FOUND" }));
      await expectCode(
        () => service.create(tenant, body({ enabled: false })),
        "WG_NODE_NOT_FOUND",
      );
    });

    it("create: чужой владелец без права назначения — 403", async () => {
      await expectCode(
        () => service.create(tenant, body({ ownerId: uuid() })),
        "WG_FORWARD_FORBIDDEN",
      );
    });

    it("list: с областью own — только свои", async () => {
      repo.findPage = sinon.stub().resolves([[], 0]);

      await service.list(tenant, { offset: 0, limit: 20 });
      expect(repo.findPage.firstCall.args[1]).to.equal(tenant.userId);

      await service.list(admin, { offset: 0, limit: 20 });
      expect(repo.findPage.secondCall.args[1]).to.equal(undefined);
    });

    it("чужой — 404; свой без права удаления — 403; прежняя цель не перепроверяется", async () => {
      repo.findWithNodes.resolves({ id: "f1", ...body(), ownerId: uuid2() });
      await expectCode(
        () => service.update(tenant, "f1", { enabled: false }),
        "WG_FORWARD_NOT_FOUND",
      );

      repo.findWithNodes.resolves({
        id: "f1",
        ...body(),
        enabled: false,
        createdById: tenant.userId,
      });
      await expectCode(
        () => service.delete(tenant, "f1"),
        "WG_FORWARD_FORBIDDEN",
      );

      await service.update(tenant, "f1", { targetNodeId: targetId });
      expect(nodes.findFor.called).to.be.false;
    });

    it("assign: событие с прежним владельцем", async () => {
      repo.update = sinon.stub().resolves({});
      repo.findWithNodes.resolves({ id: "f1", ...body(), ownerId: uuid2() });

      await service.assign(admin, "f1", { userId: uuid3() });
      expect(repo.update.firstCall.args[1]).to.deep.equal({ ownerId: uuid3() });
      expect(eventBus.emit.lastCall.args[0].previousOwnerId).to.equal(uuid2());

      await service.revoke(admin, "f1");
      expect(repo.update.secondCall.args[1]).to.deep.equal({ ownerId: null });
    });
  });
});
