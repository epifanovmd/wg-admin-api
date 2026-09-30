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
import { WgPeerService } from "./wg-peer.service";

const viewer = {
  userId: uuid(),
  roles: ["user"],
  permissions: ["wg:peer:view"],
};
const owner = {
  userId: uuid2(),
  roles: ["user"],
  permissions: ["wg:peer:view:own", "wg:peer:toggle:own"],
};
/** Видит все пиры, меняет и удаляет только свои. */
const editor = {
  userId: uuid2(),
  roles: ["user"],
  permissions: ["wg:peer:view", "wg:peer:update:own", "wg:peer:delete:own"],
};
const stranger = { userId: uuid3(), roles: ["user"], permissions: [] };
const admin = { userId: uuid(), roles: ["admin"], permissions: ["*"] };

describe("WgPeerService", () => {
  let service: WgPeerService;
  let repo: ReturnType<typeof createMockRepository> & {
    findWithRelations: sinon.SinonStub;
    usedAddresses: sinon.SinonStub;
    findEnabledByInterfaces: sinon.SinonStub;
    findExpired: sinon.SinonStub;
    findByPublicKeys: sinon.SinonStub;
    findPage: sinon.SinonStub;
    getRepository: sinon.SinonStub;
  };
  let txRepo: ReturnType<typeof createMockRepository>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let interfaces: {
    findEntity: sinon.SinonStub;
    markInterfaceDirty: sinon.SinonStub;
  };
  let nodes: { markDirty: sinon.SinonStub };
  let secrets: { seal: sinon.SinonStub; open: sinon.SinonStub };
  let dataSource: { transaction: sinon.SinonStub };

  const iface = {
    id: uuid(),
    nodeId: uuid2(),
    name: "wg0",
    addressCidr: "10.0.0.1/24",
    addressV6Cidr: null,
    publicKey: "SRVPUB",
    dns: "1.1.1.1",
    mtu: null,
    endpoint: null,
    endpointId: null,
    endpointPort: null,
    listenPort: 51820,
    node: { id: uuid2(), name: "node", publicHost: "1.2.3.4" },
  };

  const makePeer = (overrides: Record<string, unknown> = {}) => ({
    id: uuid(),
    interfaceId: iface.id,
    iface,
    userId: null,
    createdById: null,
    name: "peer-1",
    description: null,
    publicKey: "PUB",
    privateKeyEnc: "enc:PRIV",
    presharedKeyEnc: "enc:PSK",
    addressV4: "10.0.0.2",
    addressV6: null,
    clientAllowedIPs: "0.0.0.0/0, ::/0",
    clientDns: null,
    clientMtu: null,
    persistentKeepalive: 25,
    enabled: true,
    disabledReason: null,
    expiresAt: null,
    lastHandshakeAt: null,
    lastEndpoint: null,
    rxBytesTotal: 0,
    txBytesTotal: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    txRepo = createMockRepository();
    repo = {
      ...createMockRepository(),
      findWithRelations: sinon.stub(),
      usedAddresses: sinon.stub().resolves([]),
      findEnabledByInterfaces: sinon.stub().resolves([]),
      findExpired: sinon.stub().resolves([]),
      findByPublicKeys: sinon.stub().resolves([]),
      findPage: sinon.stub().resolves([[], 0]),
      getRepository: sinon.stub().returns(txRepo),
    };
    eventBus = createMockEventBus();
    interfaces = {
      findEntity: sinon.stub().resolves(iface),
      markInterfaceDirty: sinon.stub().resolves(),
    };
    nodes = { markDirty: sinon.stub().resolves() };
    secrets = {
      seal: sinon.stub().callsFake((v: string) => `enc:${v}`),
      open: sinon.stub().callsFake((v: string) => v.replace("enc:", "")),
    };
    dataSource = { transaction: sinon.stub().callsFake((cb: any) => cb({})) };
    service = new WgPeerService(
      repo as any,
      interfaces as any,
      nodes as any,
      secrets as any,
      eventBus as any,
      dataSource as any,
    );
  });

  it("create: выделяет IP, шифрует ключи, метит ноду dirty", async () => {
    txRepo.save.callsFake(async (data: any) => ({ ...makePeer(), ...data }));
    repo.findWithRelations.resolves(makePeer());

    await service.create(admin as any, {
      interfaceId: iface.id,
      name: "peer-1",
    });

    const saved = txRepo.save.firstCall.args[0];

    expect(saved.addressV4).to.equal("10.0.0.2");
    expect(saved.privateKeyEnc).to.match(/^enc:/);
    expect(saved.presharedKeyEnc).to.match(/^enc:/);
    // Версия поднимается у всех копий интерфейса (основная нода и реплики).
    expect(interfaces.markInterfaceDirty.calledWith(iface.id)).to.be.true;
  });

  it("create с publicKey: импорт без приватного ключа", async () => {
    txRepo.save.callsFake(async (data: any) => ({ ...makePeer(), ...data }));
    repo.findWithRelations.resolves(makePeer({ privateKeyEnc: null }));

    await service.create(admin as any, {
      interfaceId: iface.id,
      name: "peer-1",
      publicKey: "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=",
      withPresharedKey: false,
    });

    const saved = txRepo.save.firstCall.args[0];

    expect(saved.privateKeyEnc).to.equal(null);
    expect(saved.presharedKeyEnc).to.equal(null);
  });

  it("create: создатель — автор запроса", async () => {
    txRepo.save.callsFake(async (data: any) => ({ ...makePeer(), ...data }));
    repo.findWithRelations.resolves(makePeer());

    await service.create(editor as any, {
      interfaceId: iface.id,
      name: "peer-1",
    });

    expect(txRepo.save.firstCall.args[0].createdById).to.equal(editor.userId);
  });

  it("create с чужим держателем без права назначения — 403", async () => {
    try {
      await service.create(editor as any, {
        interfaceId: iface.id,
        name: "peer-1",
        userId: uuid3(),
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_FORBIDDEN");
    }
  });

  it("list: с областью own список ограничивается своими", async () => {
    await service.list(owner as any, {}, { offset: 0, limit: 20 });

    expect(repo.findPage.firstCall.args[0].ownedBy).to.equal(owner.userId);
  });

  it("list: с правом на все — без ограничения", async () => {
    await service.list(editor as any, {}, { offset: 0, limit: 20 });

    expect(repo.findPage.firstCall.args[0].ownedBy).to.equal(undefined);
  });

  it("list: без права просмотра — 403", async () => {
    try {
      await service.list(stranger as any, {}, { offset: 0, limit: 20 });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_FORBIDDEN");
    }
  });

  it("get: чужой пир для own-пользователя — 404", async () => {
    repo.findWithRelations.resolves(makePeer({ userId: uuid3() }));

    try {
      await service.get(owner as any, uuid());
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_NOT_FOUND");
    }
  });

  it("buildConfig: собирает конфиг с расшифрованными ключами", async () => {
    repo.findWithRelations.resolves(makePeer({ userId: owner.userId }));

    const { content, fileName } = await service.buildConfig(
      owner as any,
      uuid(),
    );

    expect(fileName).to.equal("peer-1.conf");
    expect(content).to.include("PrivateKey = PRIV");
    expect(content).to.include("PresharedKey = PSK");
    expect(content).to.include("Endpoint = 1.2.3.4:51820");
    expect(content).to.include("DNS = 1.1.1.1");
  });

  it("buildConfig: импортированный пир — 409", async () => {
    repo.findWithRelations.resolves(makePeer({ privateKeyEnc: null }));

    try {
      await service.buildConfig(viewer as any, uuid());
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_NO_PRIVATE_KEY");
    }
  });

  it("setEnabled: держатель выключает свой пир", async () => {
    const peer = makePeer({ userId: owner.userId });

    repo.findWithRelations.resolves(peer);

    await service.setEnabled(owner as any, peer.id, false);

    expect(peer.enabled).to.be.false;
    expect(peer.disabledReason).to.equal("manual");
  });

  it("update: видит все, но чужой пир менять нельзя — 403", async () => {
    repo.findWithRelations.resolves(makePeer({ userId: uuid3() }));

    try {
      await service.update(editor as any, uuid(), { name: "x" });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_FORBIDDEN");
    }
  });

  it("update: созданный собой пир с чужим держателем — можно", async () => {
    const peer = makePeer({ userId: uuid3(), createdById: editor.userId });

    repo.findWithRelations.resolves(peer);

    await service.update(editor as any, peer.id, { name: "renamed" });

    expect(peer.name).to.equal("renamed");
  });

  it("delete: без права удаления своих — 403", async () => {
    repo.findWithRelations.resolves(makePeer({ userId: owner.userId }));

    try {
      await service.delete(owner as any, uuid());
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_FORBIDDEN");
    }
  });

  it("setEnabled: чужой пир — 404", async () => {
    repo.findWithRelations.resolves(makePeer({ userId: uuid3() }));

    try {
      await service.setEnabled(owner as any, uuid(), false);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_PEER_NOT_FOUND");
    }
  });

  it("assign: событие изменения несёт прежнего держателя", async () => {
    repo.findWithRelations
      .onFirstCall()
      .resolves(makePeer({ userId: owner.userId }))
      .onSecondCall()
      .resolves(makePeer({ userId: uuid3() }));

    await service.assign(admin as any, uuid(), { userId: uuid3() });

    const event = eventBus.emit.lastCall.args[0];

    expect(event.previousUserId).to.equal(owner.userId);
  });

  it("revoke: событие изменения несёт прежнего держателя", async () => {
    repo.findWithRelations
      .onFirstCall()
      .resolves(makePeer({ userId: owner.userId }))
      .onSecondCall()
      .resolves(makePeer({ userId: null }));

    await service.revoke(admin as any, uuid());

    expect(eventBus.emit.lastCall.args[0].previousUserId).to.equal(
      owner.userId,
    );
  });

  it("assign тому же держателю — прежнего нет", async () => {
    repo.findWithRelations.callsFake(async () =>
      makePeer({ userId: owner.userId }),
    );

    await service.assign(admin as any, uuid(), { userId: owner.userId });

    expect(eventBus.emit.lastCall.args[0].previousUserId).to.equal(null);
  });

  it("disableExpired: выключает с причиной expired и метит ноды", async () => {
    const peer = makePeer({ expiresAt: new Date(Date.now() - 1000) });

    repo.findExpired.resolves([peer]);
    repo.findWithRelations.resolves(peer);

    const count = await service.disableExpired();

    expect(count).to.equal(1);
    expect(peer.enabled).to.be.false;
    expect(peer.disabledReason).to.equal("expired");
    expect(interfaces.markInterfaceDirty.called).to.be.true;
  });

  it("serverPeers: расшифровывает PSK и собирает AllowedIPs", async () => {
    repo.findEnabledByInterfaces.resolves([
      makePeer({ addressV6: "fd00:10::2" }),
    ]);

    const map = await service.serverPeers([iface.id]);
    const peers = map.get(iface.id)!;

    expect(peers[0].presharedKey).to.equal("PSK");
    expect(peers[0].allowedIps).to.equal("10.0.0.2/32, fd00:10::2/128");
  });
});
