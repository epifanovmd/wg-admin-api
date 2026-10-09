import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
  uuid3,
} from "../../test/helpers";
import { WgInterfaceGuard } from "./wg-interface.guard";
import { WgInterfaceService } from "./wg-interface.service";
import { EWgInterfaceStatus } from "./wg-interface.types";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";

const superUser = { userId: uuid(), roles: ["admin"], permissions: ["*"] };
const manager = {
  userId: uuid(),
  roles: ["user"],
  permissions: [
    "wg:interface:create",
    "wg:interface:view",
    "wg:interface:update",
  ],
};
/** Только свои интерфейсы: видит, меняет, управляет; ноды — все. */
const tenant = {
  userId: uuid3(),
  roles: ["user"],
  permissions: [
    "wg:node:view",
    "wg:interface:create",
    "wg:interface:view:own",
    "wg:interface:update:own",
    "wg:interface:control:own",
  ],
};

describe("WgInterfaceService", () => {
  let service: WgInterfaceService;
  let repo: ReturnType<typeof createMockRepository> & {
    findWithRelations: sinon.SinonStub;
    findByNode: sinon.SinonStub;
    findForNode: sinon.SinonStub;
    nodeNameInUse: sinon.SinonStub;
    findByEndpoint: sinon.SinonStub;
    targetNodeIdsForRelay: sinon.SinonStub;
    findServedByRelay: sinon.SinonStub;
    endpointPortInUse: sinon.SinonStub;
    relayForwardPortInUse: sinon.SinonStub;
    nodeListenPortInUse: sinon.SinonStub;
    getRepository: sinon.SinonStub;
  };
  let eventBus: ReturnType<typeof createMockEventBus>;
  let nodes: {
    findEntity: sinon.SinonStub;
    findFor: sinon.SinonStub;
    markDirty: sinon.SinonStub;
    markDirtyMany: sinon.SinonStub;
  };
  let endpoints: { findEntity: sinon.SinonStub };
  let relaySync: { syncRelaySafe: sinon.SinonStub };
  let secrets: { seal: sinon.SinonStub; open: sinon.SinonStub };
  let nodeAgents: { restartInterface: sinon.SinonStub };
  let txRepo: ReturnType<typeof createMockRepository>;
  let dataSource: { transaction: sinon.SinonStub };

  let replicasRepo: {
    update: sinon.SinonStub;
    findOne: sinon.SinonStub;
    getRepository: sinon.SinonStub;
  };

  beforeEach(() => {
    replicasRepo = {
      update: sinon.stub().resolves({ affected: 0 }),
      findOne: sinon.stub().resolves(null),
      getRepository: sinon.stub(),
    };
    replicasRepo.getRepository.returns(replicasRepo);
    txRepo = createMockRepository();
    repo = {
      ...createMockRepository(),
      findWithRelations: sinon.stub(),
      findByNode: sinon.stub(),
      findForNode: sinon.stub().resolves([]),
      nodeNameInUse: sinon.stub().resolves(false),
      findByEndpoint: sinon.stub(),
      targetNodeIdsForRelay: sinon.stub(),
      findServedByRelay: sinon.stub(),
      endpointPortInUse: sinon.stub().resolves(false),
      relayForwardPortInUse: sinon.stub().resolves(false),
      nodeListenPortInUse: sinon.stub().resolves(false),
      getRepository: sinon.stub().returns(txRepo),
    };
    eventBus = createMockEventBus();
    nodes = {
      findEntity: sinon.stub().resolves({}),
      findFor: sinon.stub().resolves({}),
      markDirty: sinon.stub().resolves(),
      markDirtyMany: sinon.stub().resolves(),
    };
    endpoints = { findEntity: sinon.stub() };
    // Видимость точки актору — как у findEntity; отказ проверяется отдельно.
    Object.assign(endpoints, {
      findFor: (_actor: unknown, id: string) => endpoints.findEntity(id),
    });
    relaySync = { syncRelaySafe: sinon.stub().resolves() };
    secrets = {
      seal: sinon.stub().callsFake((v: string) => `enc:${v}`),
      open: sinon.stub().callsFake((v: string) => v.replace("enc:", "")),
    };
    nodeAgents = {
      restartInterface: sinon.stub().resolves({ name: "wg0", status: "up" }),
    };
    dataSource = {
      transaction: sinon.stub().callsFake((cb: any) => cb({})),
    };
    const guard = new WgInterfaceGuard(repo as any, nodes as any, []);

    service = new WgInterfaceService(
      repo as any,
      nodes as any,
      nodeAgents as any,
      endpoints as any,
      relaySync as any,
      secrets as any,
      eventBus as any,
      dataSource as any,
      guard,
      new WgInterfaceReplicaService(
        repo as any,
        replicasRepo as any,
        guard,
        nodes as any,
        relaySync as any,
        eventBus as any,
        dataSource as any,
      ),
    );
  });

  const makeIface = (overrides: Record<string, unknown> = {}) => ({
    id: uuid(),
    nodeId: uuid2(),
    name: "wg0",
    listenPort: 51820,
    addressCidr: "10.0.0.1/24",
    addressV6Cidr: null,
    privateKeyEnc: "enc:priv",
    publicKey: "pub",
    dns: null,
    mtu: null,
    endpointId: null,
    endpoint: null,
    endpointPort: null,
    natEnabled: true,
    customPostUp: null,
    customPostDown: null,
    enabled: true,
    ownerId: null,
    createdById: null,
    status: EWgInterfaceStatus.Unknown,
    statusMessage: null,
    node: { id: uuid2(), name: "node", publicHost: "1.2.3.4" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it("create: генерирует ключи, шифрует приватный и метит ноду dirty", async () => {
    const iface = makeIface();

    txRepo.save.callsFake(async (data: any) => ({ ...iface, ...data }));
    repo.findWithRelations.resolves(iface);

    const dto = await service.create(superUser as any, {
      nodeId: iface.nodeId,
      name: "wg0",
      listenPort: 51820,
      addressCidr: "10.0.0.1/24",
    });

    const saved = txRepo.save.firstCall.args[0];

    expect(saved.privateKeyEnc).to.match(/^enc:/);
    expect(saved.publicKey).to.have.length(44);
    expect(nodes.markDirty.calledWith(iface.nodeId)).to.be.true;
    expect(dto.id).to.equal(iface.id);
  });

  it("create: произвольные хуки без права wg:interface:hooks — 403", async () => {
    try {
      await service.create(manager as any, {
        nodeId: uuid(),
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
        customPostUp: "iptables ...",
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_IFACE_CUSTOM_HOOKS_FORBIDDEN");
    }
  });

  it("create: право wg:interface:hooks разрешает произвольные хуки", async () => {
    const iface = makeIface({ customPostUp: "iptables ..." });

    txRepo.save.callsFake(async (data: any) => ({ ...iface, ...data }));
    repo.findWithRelations.resolves(iface);

    const dto = await service.create(
      {
        ...manager,
        permissions: [
          ...manager.permissions,
          "wg:interface:hooks",
          "wg:node:update",
        ],
      } as any,
      {
        nodeId: uuid(),
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
        customPostUp: "iptables ...",
      },
    );

    expect(txRepo.save.firstCall.args[0].customPostUp).to.equal("iptables ...");
    expect(dto.id).to.equal(iface.id);
  });

  it("create: занятый порт точки подключения — 409", async () => {
    endpoints.findEntity.resolves({ id: uuid(), relayNodeId: null });
    repo.endpointPortInUse.resolves(true);

    try {
      await service.create(superUser as any, {
        nodeId: uuid(),
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
        endpointId: uuid2(),
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_IFACE_ENDPOINT_PORT_TAKEN");
    }
  });

  it("create: релей точки — нода самого интерфейса — 409", async () => {
    // Иначе линк «нода → та же нода»: туннель сам в себя, клиенты,
    // идущие на адрес точки, никуда не попадают.
    const nodeId = uuid();

    endpoints.findEntity.resolves({
      id: uuid2(),
      mode: "relay",
      relayNodeId: nodeId,
    });

    try {
      await service.create(superUser as any, {
        nodeId,
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
        endpointId: uuid2(),
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_IFACE_ENDPOINT_RELAY_IS_NODE");
    }
    expect(txRepo.save.called).to.be.false;
  });

  it("update: смена точки на релей с этой же ноды — 409", async () => {
    const iface = makeIface();

    repo.findWithRelations.resolves(iface);
    endpoints.findEntity.resolves({
      id: uuid(),
      mode: "relay",
      relayNodeId: iface.nodeId,
    });

    try {
      await service.update(superUser as any, iface.id, { endpointId: uuid() });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_IFACE_ENDPOINT_RELAY_IS_NODE");
    }
  });

  describe("перенос на другую ноду", () => {
    it("меняет ноду, поднимает версии обеих нод и синхронизирует релей", async () => {
      const relayNodeId = uuid2();
      const iface = makeIface({
        endpointId: uuid(),
        endpoint: { id: uuid(), mode: "relay", relayNodeId },
      });
      const oldNodeId = iface.nodeId;
      const targetNodeId = "33333333-3333-4333-8333-333333333333";

      repo.findWithRelations.resolves(iface);

      await service.move(superUser as any, iface.id, targetNodeId);

      expect(txRepo.save.firstCall.args[0].nodeId).to.equal(targetNodeId);
      expect(nodes.markDirty.calledWith(oldNodeId)).to.be.true;
      expect(nodes.markDirty.calledWith(targetNodeId)).to.be.true;
      expect(relaySync.syncRelaySafe.calledWith(relayNodeId)).to.be.true;
    });

    it("на ту же ноду — 400; на релей своей точки — 409", async () => {
      const relayNodeId = "44444444-4444-4444-8444-444444444444";
      const iface = makeIface({
        endpointId: uuid(),
        endpoint: { id: uuid(), mode: "relay", relayNodeId },
      });

      repo.findWithRelations.resolves(iface);

      for (const [target, code] of [
        [iface.nodeId, "WG_IFACE_MOVE_SAME_NODE"],
        [relayNodeId, "WG_IFACE_ENDPOINT_RELAY_IS_NODE"],
      ]) {
        try {
          await service.move(superUser as any, iface.id, target);
          expect.fail("должно было упасть");
        } catch (err: any) {
          expect(err.code).to.equal(code);
        }
      }
      expect(txRepo.save.called).to.be.false;
    });
  });

  describe("порты на релее", () => {
    const relayNodeId = uuid2();
    const relayEndpoint = { id: uuid(), mode: "relay", relayNodeId };
    const body = {
      nodeId: uuid(),
      name: "wg1",
      listenPort: 51821,
      endpointPort: 51820,
      addressCidr: "10.20.0.1/24",
      endpointId: relayEndpoint.id,
    };

    const expectCode = async (code: string) => {
      try {
        await service.create(superUser as any, body);
        expect.fail("должно было упасть");
      } catch (err: any) {
        expect(err.code).to.equal(code);
      }
      expect(txRepo.save.called).to.be.false;
    };

    it("порт занят пробросом другой точки того же релея — 409", async () => {
      // Порт проверяется по всем точкам релея: два DNAT на один порт недопустимы.
      endpoints.findEntity.resolves(relayEndpoint);
      repo.relayForwardPortInUse
        .withArgs(relayNodeId, 51820, sinon.match.any)
        .resolves(true);

      await expectCode("WG_IFACE_RELAY_PORT_TAKEN");
    });

    it("порт занят собственным интерфейсом релей-ноды — 409", async () => {
      // DNAT в PREROUTING перехватил бы трафик локального WireGuard релея.
      endpoints.findEntity.resolves(relayEndpoint);
      repo.nodeListenPortInUse.withArgs(relayNodeId, 51820).resolves(true);

      await expectCode("WG_IFACE_RELAY_PORT_TAKEN");
    });

    it("порт занят чужим процессом на хосте релея (по отчёту агента) — 409", async () => {
      // DNAT агента перехватил бы трафик процесса, слушающего этот порт.
      endpoints.findEntity.resolves(relayEndpoint);
      nodes.findEntity
        .withArgs(relayNodeId)
        .resolves({ id: relayNodeId, osInfo: { udpPorts: [53, 51820] } });

      await expectCode("WG_IFACE_RELAY_PORT_BUSY");
    });

    it("свой listen-порт занят пробросом этой ноды как релея — 409", async () => {
      endpoints.findEntity.resolves(null);
      repo.relayForwardPortInUse
        .withArgs(body.nodeId, 51821, sinon.match.any)
        .resolves(true);

      try {
        await service.create(superUser as any, {
          ...body,
          endpointId: undefined,
        });
        expect.fail("должно было упасть");
      } catch (err: any) {
        expect(err.code).to.equal("WG_IFACE_PORT_FORWARDED");
      }
    });
  });

  it("updateReportedStatuses: событие только при изменении", async () => {
    const changed = makeIface({ status: EWgInterfaceStatus.Down });
    const same = makeIface({
      name: "wg1",
      status: EWgInterfaceStatus.Up,
    });

    // Реплика чужого интерфейса на этой ноде: статус — в строку реплики.
    const replicated = makeIface({
      name: "wg2",
      nodeId: "44444444-4444-4444-8444-444444444444",
    });

    repo.findForNode.resolves([changed, same, replicated]);
    repo.update.resolves({});
    replicasRepo.findOne.resolves({
      status: EWgInterfaceStatus.Unknown,
      iface: { endpoint: { relayNodeId: "relay" } },
    });
    replicasRepo.update.resolves({ affected: 1 });
    repo.findWithRelations.resolves({
      ...changed,
      status: EWgInterfaceStatus.Up,
    });

    await service.updateReportedStatuses(changed.nodeId, [
      { name: "wg0", status: EWgInterfaceStatus.Up },
      { name: "wg1", status: EWgInterfaceStatus.Up },
      { name: "wg2", status: EWgInterfaceStatus.Up },
    ]);

    // Интерфейс ноды и реплика — по событию; у реплики сменился статус.
    expect(eventBus.emit.callCount).to.equal(2);
    expect(repo.update.firstCall.args).to.deep.equal([
      { id: changed.id },
      { status: EWgInterfaceStatus.Up, statusMessage: null },
    ]);
    // Событие — полным DTO (с копиями), как у остальных изменений.
    expect(eventBus.emit.firstCall.args[0].iface.status).to.equal(
      EWgInterfaceStatus.Up,
    );
    expect(replicated.status).to.equal(EWgInterfaceStatus.Unknown);
    expect(replicasRepo.update.firstCall.args[0]).to.include({
      interfaceId: replicated.id,
      nodeId: changed.nodeId,
    });
    // Реплика поднялась — релей точки получает новую версию (резерв).
    expect(nodes.markDirty.calledWith("relay")).to.be.true;
  });

  it("статус реплики не менялся — ни события, ни новой версии релея", async () => {
    const replicated = makeIface({
      name: "wg2",
      nodeId: "44444444-4444-4444-8444-444444444444",
    });

    repo.findForNode.resolves([replicated]);
    replicasRepo.findOne.resolves({
      status: EWgInterfaceStatus.Up,
      iface: { endpoint: { relayNodeId: "relay" } },
    });

    await service.updateReportedStatuses(
      "55555555-5555-4555-8555-555555555555",
      [{ name: "wg2", status: EWgInterfaceStatus.Up }],
    );

    expect(eventBus.emit.called).to.be.false;
    expect(nodes.markDirty.called).to.be.false;
  });

  it("restart: запрос к воркеру wg основной ноды, итог — в ответе", async () => {
    const iface = makeIface();

    repo.findWithRelations.resolves(iface);

    const result = await service.restart(superUser as any, iface.id);

    expect(result).to.deep.equal({ name: "wg0", status: "up" });
    expect(
      nodeAgents.restartInterface.calledWith(
        iface.nodeId,
        "wg0",
        sinon.match.string,
      ),
    ).to.be.true;
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

    it("create: создатель — автор, нода проверяется на видимость актору", async () => {
      const iface = makeIface();

      txRepo.save.callsFake(async (data: any) => ({ ...iface, ...data }));
      repo.findWithRelations.resolves(iface);

      await service.create(tenant as any, {
        nodeId: iface.nodeId,
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
      });

      expect(txRepo.save.firstCall.args[0]).to.include({
        createdById: tenant.userId,
        ownerId: null,
      });
      expect(nodes.findFor.firstCall.args).to.deep.equal([
        tenant,
        iface.nodeId,
        "wg:node:view",
      ]);
    });

    it("create: невидимая нода — ошибка ноды, интерфейс не создаётся", async () => {
      nodes.findFor.rejects(
        Object.assign(new Error("nf"), { code: "WG_NODE_NOT_FOUND" }),
      );

      await expectCode(
        () =>
          service.create(tenant as any, {
            nodeId: uuid(),
            name: "wg0",
            listenPort: 51820,
            addressCidr: "10.0.0.1/24",
          }),
        "WG_NODE_NOT_FOUND",
      );
      expect(txRepo.save.called).to.be.false;
    });

    it("create: чужой владелец без права назначения — 403", async () => {
      await expectCode(
        () =>
          service.create(tenant as any, {
            nodeId: uuid(),
            name: "wg0",
            listenPort: 51820,
            addressCidr: "10.0.0.1/24",
            ownerId: uuid(),
          }),
        "WG_IFACE_FORBIDDEN",
      );
    });

    it("list: с областью own — только свои", async () => {
      const findPage = sinon.stub().resolves([[], 0]);

      Object.assign(repo, { findPage });
      await service.list(tenant as any, {}, { offset: 0, limit: 20 });
      await service.list(manager as any, {}, { offset: 0, limit: 20 });

      expect(findPage.firstCall.args[0].ownedBy).to.equal(tenant.userId);
      expect(findPage.secondCall.args[0].ownedBy).to.equal(undefined);
    });

    it("list и options: «Мои» — только свои и при праве на все", async () => {
      const findPage = sinon.stub().resolves([[], 0]);

      Object.assign(repo, { findPage });
      await service.list(
        manager as any,
        { mine: true, nodeId: uuid2() },
        { offset: 0, limit: 20 },
      );
      expect(findPage.firstCall.args[0]).to.deep.equal({
        nodeId: uuid2(),
        ownedBy: manager.userId,
      });

      repo.find.resolves([]);
      await service.options(manager as any, undefined, true);
      expect(repo.find.firstCall.args[0].where).to.deep.equal([
        { ownerId: manager.userId },
        { createdById: manager.userId },
      ]);
    });

    it("options: свои с фильтром ноды", async () => {
      repo.find.resolves([]);
      await service.options(tenant as any, uuid2());

      expect(repo.find.firstCall.args[0].where).to.deep.equal([
        { ownerId: tenant.userId, nodeId: uuid2() },
        { createdById: tenant.userId, nodeId: uuid2() },
      ]);
    });

    it("get: чужой — 404, свой (владелец) — виден", async () => {
      repo.findWithRelations.resolves(makeIface({ ownerId: uuid2() }));
      await expectCode(
        () => service.get(tenant as any, uuid()),
        "WG_IFACE_NOT_FOUND",
      );

      repo.findWithRelations.resolves(makeIface({ ownerId: tenant.userId }));
      expect((await service.get(tenant as any, uuid())).ownerId).to.equal(
        tenant.userId,
      );
    });

    it("delete: свой без права удаления — 403", async () => {
      repo.findWithRelations.resolves(
        makeIface({ createdById: tenant.userId }),
      );

      await expectCode(
        () => service.delete(tenant as any, uuid()),
        "WG_IFACE_FORBIDDEN",
      );
    });

    it("update: хуки на своём интерфейсе — только с правом hooks", async () => {
      repo.findWithRelations.resolves(makeIface({ ownerId: tenant.userId }));

      await expectCode(
        () => service.update(tenant as any, uuid(), { customPostUp: "echo" }),
        "WG_IFACE_CUSTOM_HOOKS_FORBIDDEN",
      );
    });

    it("move: целевая нода проверяется на видимость актору", async () => {
      repo.findWithRelations.resolves(makeIface());
      nodes.findFor.rejects(
        Object.assign(new Error("nf"), { code: "WG_NODE_NOT_FOUND" }),
      );

      await expectCode(
        () => service.move(superUser as any, uuid(), uuid3()),
        "WG_NODE_NOT_FOUND",
      );
      expect(txRepo.save.called).to.be.false;
    });

    it("assign и revoke: событие с прежним владельцем, если он сменился", async () => {
      const iface = makeIface({ ownerId: uuid2() });

      repo.findWithRelations.resolves(iface);

      await service.assign(superUser as any, iface.id, { userId: uuid3() });
      expect(repo.update.lastCall.args[1]).to.deep.equal({ ownerId: uuid3() });
      expect(eventBus.emit.lastCall.args[0].previousOwnerId).to.equal(uuid2());

      await service.revoke(superUser as any, iface.id);
      expect(repo.update.lastCall.args[1]).to.deep.equal({ ownerId: null });

      await service.assign(superUser as any, iface.id, { userId: uuid2() });
      expect(eventBus.emit.lastCall.args[0].previousOwnerId).to.equal(null);
    });

    it("delete: событие несёт владельца и создателя", async () => {
      const iface = makeIface({ ownerId: uuid2(), createdById: uuid3() });

      repo.findWithRelations.resolves(iface);
      await service.delete(superUser as any, iface.id);

      expect(eventBus.emit.lastCall.args[0]).to.include({
        ownerId: uuid2(),
        createdById: uuid3(),
      });
    });

    it("точка подключения проверяется на видимость актору; прежняя — нет", async () => {
      const findFor = sinon
        .stub()
        .rejects(
          Object.assign(new Error("nf"), { code: "WG_ENDPOINT_NOT_FOUND" }),
        );

      Object.assign(endpoints, { findFor });
      repo.findWithRelations.resolves(
        makeIface({ ownerId: tenant.userId, endpointId: uuid2() }),
      );

      await expectCode(
        () => service.update(tenant as any, uuid(), { endpointId: uuid3() }),
        "WG_ENDPOINT_NOT_FOUND",
      );
      expect(findFor.firstCall.args).to.deep.equal([
        tenant,
        uuid3(),
        "wg:endpoint:view",
      ]);

      findFor.resetHistory();
      await service.update(tenant as any, uuid(), { endpointId: uuid2() });
      expect(findFor.called).to.be.false;
    });

    it("реплика: нода копии проверяется на видимость актору", async () => {
      repo.findWithRelations.resolves(makeIface({ replicas: [] }));
      nodes.findFor.rejects(
        Object.assign(new Error("nf"), { code: "WG_NODE_NOT_FOUND" }),
      );

      const replicas = (service as any)._replicas as WgInterfaceReplicaService;

      await expectCode(
        () => replicas.addReplica(superUser as any, uuid(), uuid3()),
        "WG_NODE_NOT_FOUND",
      );
    });
  });

  describe("хуки выполняются на ноде: нужно право изменять ноду", () => {
    /** Хуки своих интерфейсов; ноды видны все, изменяются только свои. */
    const hooker = {
      userId: uuid3(),
      roles: ["user"],
      permissions: [
        "wg:node:view",
        "wg:node:update:own",
        "wg:interface:create",
        "wg:interface:view:own",
        "wg:interface:update:own",
        "wg:interface:move:own",
        "wg:interface:replicas:own",
        "wg:interface:hooks:own",
      ],
    };
    const foreignNode = { id: uuid2(), ownerId: uuid(), createdById: uuid() };
    const ownNode = { id: uuid2(), ownerId: hooker.userId, createdById: null };
    const expectHooksForbidden = async (run: () => Promise<unknown>) => {
      try {
        await run();
        expect.fail("должно было упасть");
      } catch (err: any) {
        expect(err.code).to.equal("WG_IFACE_CUSTOM_HOOKS_FORBIDDEN");
      }
      expect(txRepo.save.called).to.be.false;
    };

    it("create с хуками на чужой ноде — 403", async () => {
      nodes.findEntity.resolves(foreignNode);

      await expectHooksForbidden(() =>
        service.create(hooker as any, {
          nodeId: foreignNode.id,
          name: "wg0",
          listenPort: 51820,
          addressCidr: "10.0.0.1/24",
          customPostUp: "rm -rf /",
        }),
      );
    });

    it("create с хуками на своей ноде — можно", async () => {
      const iface = makeIface({ customPostUp: "echo" });

      nodes.findEntity.resolves(ownNode);
      txRepo.save.callsFake(async (data: any) => ({ ...iface, ...data }));
      repo.findWithRelations.resolves(iface);

      await service.create(hooker as any, {
        nodeId: ownNode.id,
        name: "wg0",
        listenPort: 51820,
        addressCidr: "10.0.0.1/24",
        customPostUp: "echo",
      });

      expect(txRepo.save.called).to.be.true;
    });

    it("update хуков своего интерфейса на чужой ноде — 403", async () => {
      nodes.findEntity.resolves(foreignNode);
      repo.findWithRelations.resolves(
        makeIface({ ownerId: hooker.userId, replicas: [] }),
      );

      await expectHooksForbidden(() =>
        service.update(hooker as any, uuid(), { customPostUp: "echo" }),
      );
    });

    it("перенос интерфейса с хуками на чужую ноду — 403", async () => {
      nodes.findEntity.resolves(foreignNode);
      repo.findWithRelations.resolves(
        makeIface({
          ownerId: hooker.userId,
          customPostUp: "echo",
          replicas: [],
        }),
      );

      await expectHooksForbidden(() =>
        service.move(hooker as any, uuid(), uuid3()),
      );
    });

    it("копия интерфейса с хуками на чужой ноде — 403", async () => {
      nodes.findEntity.resolves(foreignNode);
      repo.findWithRelations.resolves(
        makeIface({
          ownerId: hooker.userId,
          customPostUp: "echo",
          replicas: [],
        }),
      );

      const replicas = (service as any)._replicas as WgInterfaceReplicaService;

      await expectHooksForbidden(() =>
        replicas.addReplica(hooker as any, uuid(), uuid3()),
      );
    });
  });
});
