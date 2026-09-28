import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
  uuid2,
} from "../../test/helpers";
import { WgInterfaceGuard } from "./wg-interface.guard";
import { WgInterfaceService } from "./wg-interface.service";
import { EWgInterfaceStatus } from "./wg-interface.types";
import { WgInterfaceReplicaService } from "./wg-interface-replica.service";

const superUser = { userId: uuid(), roles: ["admin"], permissions: ["*"] };
const manager = {
  userId: uuid(),
  roles: ["user"],
  permissions: ["wg:interface:create", "wg:interface:update"],
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
    markDirty: sinon.SinonStub;
    markDirtyMany: sinon.SinonStub;
  };
  let endpoints: { findEntity: sinon.SinonStub };
  let relaySync: { syncRelaySafe: sinon.SinonStub };
  let secrets: { seal: sinon.SinonStub; open: sinon.SinonStub };
  let commands: { createInterfaceRestart: sinon.SinonStub };
  let txRepo: ReturnType<typeof createMockRepository>;
  let dataSource: { transaction: sinon.SinonStub };

  let replicasRepo: { update: sinon.SinonStub; getRepository: sinon.SinonStub };

  beforeEach(() => {
    replicasRepo = {
      update: sinon.stub().resolves({ affected: 0 }),
      getRepository: sinon.stub().returns(createMockRepository()),
    };
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
      markDirty: sinon.stub().resolves(),
      markDirtyMany: sinon.stub().resolves(),
    };
    endpoints = { findEntity: sinon.stub() };
    relaySync = { syncRelaySafe: sinon.stub().resolves() };
    secrets = {
      seal: sinon.stub().callsFake((v: string) => `enc:${v}`),
      open: sinon.stub().callsFake((v: string) => v.replace("enc:", "")),
    };
    commands = { createInterfaceRestart: sinon.stub().resolves({}) };
    dataSource = {
      transaction: sinon.stub().callsFake((cb: any) => cb({})),
    };
    const guard = new WgInterfaceGuard(repo as any, nodes as any, []);

    service = new WgInterfaceService(
      repo as any,
      nodes as any,
      commands as any,
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
        permissions: [...manager.permissions, "wg:interface:hooks"],
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

      await service.move(iface.id, targetNodeId);

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
          await service.move(iface.id, target);
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
    repo.findWithRelations.resolves({
      ...changed,
      status: EWgInterfaceStatus.Up,
    });

    await service.updateReportedStatuses(changed.nodeId, [
      { name: "wg0", status: EWgInterfaceStatus.Up },
      { name: "wg1", status: EWgInterfaceStatus.Up },
      { name: "wg2", status: EWgInterfaceStatus.Up },
    ]);

    expect(eventBus.emit.callCount).to.equal(1);
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
  });

  it("restart: создаёт команду агенту", async () => {
    const iface = makeIface();

    repo.findWithRelations.resolves(iface);

    await service.restart(uuid(), iface.id);

    expect(
      commands.createInterfaceRestart.calledWith(
        iface.nodeId,
        sinon.match.string,
        "wg0",
      ),
    ).to.be.true;
  });
});
