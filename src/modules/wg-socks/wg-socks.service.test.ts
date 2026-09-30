import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import { uuid, uuid2, uuid3 } from "../../test/helpers";
import { WgSocksAppService } from "./wg-socks.service";

const admin = { userId: uuid(), roles: ["admin"], permissions: ["*"] } as any;
/** Только свои прокси; ноды — все. */
const tenant = {
  userId: uuid3(),
  roles: ["user"],
  permissions: [
    "wg:node:view",
    "wg:socks:create",
    "wg:socks:view:own",
    "wg:socks:users:own",
  ],
} as any;

describe("WgSocksAppService: область «все / свои»", () => {
  let services: Record<string, sinon.SinonStub>;
  let nodes: Record<string, sinon.SinonStub>;
  let eventBus: { emit: sinon.SinonStub };
  let txRepo: Record<string, sinon.SinonStub>;
  let service: WgSocksAppService;

  const makeSocks = (overrides: Record<string, unknown> = {}) => ({
    id: "s1",
    ownerId: null,
    createdById: null,
    name: "tg",
    nodeId: uuid2(),
    listenPort: 8444,
    users: [],
    clients: [],
    ...overrides,
  });
  const expectCode = async (run: () => Promise<unknown>, code: string) => {
    try {
      await run();
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal(code);
    }
  };

  beforeEach(() => {
    txRepo = {
      save: sinon
        .stub()
        .callsFake(async (data: any) => ({ id: "s1", ...data })),
      delete: sinon.stub().resolves(),
    };
    services = {
      findWithRelations: sinon.stub().resolves(makeSocks()),
      findAllWithRelations: sinon.stub().resolves([]),
      update: sinon.stub().resolves({}),
      find: sinon.stub().resolves([]),
    };
    Object.assign(services, { target: "WgSocksService" });
    nodes = {
      findFor: sinon
        .stub()
        .resolves({ id: uuid2(), name: "n", publicHost: "203.0.113.5" }),
      markDirty: sinon.stub().resolves(),
    };
    eventBus = { emit: sinon.stub() };
    service = new WgSocksAppService(
      services as any,
      { target: "WgSocksUser" } as any,
      { target: "WgSocksClient" } as any,
      nodes as any,
      { seal: (v: string) => `enc:${v}`, open: (v: string) => v } as any,
      { getJson: sinon.stub().resolves(null), setJson: sinon.stub() } as any,
      {
        transaction: (cb: any) => cb({ getRepository: () => txRepo }),
      } as any,
      eventBus as any,
      [],
    );
  });

  it("create: создатель — автор, нода проверяется на видимость", async () => {
    await service.create(tenant, {
      name: "own",
      nodeId: uuid2(),
      listenPort: 8445,
    });

    expect(txRepo.save.firstCall.args[0]).to.include({
      createdById: tenant.userId,
      ownerId: null,
    });
    expect(nodes.findFor.firstCall.args).to.deep.equal([
      tenant,
      uuid2(),
      "wg:node:view",
    ]);
  });

  it("create: чужой владелец без права назначения — 403", async () => {
    await expectCode(
      () =>
        service.create(tenant, {
          name: "x",
          nodeId: uuid2(),
          listenPort: 8445,
          ownerId: uuid(),
        }),
      "WG_SOCKS_FORBIDDEN",
    );
    expect(nodes.findFor.called).to.be.false;
  });

  it("list: с областью own — только свои, без права — 403", async () => {
    await service.list(tenant);
    await service.list(admin);

    expect(services.findAllWithRelations.firstCall.args[0]).to.equal(
      tenant.userId,
    );
    expect(services.findAllWithRelations.secondCall.args[0]).to.equal(
      undefined,
    );
    await expectCode(
      () => service.list({ userId: uuid(), roles: [], permissions: [] } as any),
      "WG_SOCKS_FORBIDDEN",
    );
  });

  it("list: «Мои» — только свои и при праве на все", async () => {
    await service.list(admin, true);

    expect(services.findAllWithRelations.firstCall.args[0]).to.equal(
      admin.userId,
    );
  });

  it("чужой — 404; свой без права на действие — 403; свой — пользователи", async () => {
    services.findWithRelations.resolves(makeSocks({ ownerId: uuid2() }));
    await expectCode(() => service.get(tenant, "s1"), "WG_SOCKS_NOT_FOUND");

    services.findWithRelations.resolves(
      makeSocks({ createdById: tenant.userId }),
    );
    await expectCode(
      () => service.userSecret(tenant, "s1", "u1"),
      "WG_SOCKS_FORBIDDEN",
    );

    const secret = await service.addUser(tenant, "s1", {
      username: "tg",
      password: "password-1",
    });

    expect(secret.username).to.equal("tg");
  });

  it("assign и revoke: событие с прежним владельцем", async () => {
    services.findWithRelations.resolves(makeSocks({ ownerId: uuid2() }));

    await service.assign(admin, "s1", { userId: uuid3() });
    expect(services.update.firstCall.args[1]).to.deep.equal({
      ownerId: uuid3(),
    });
    expect(eventBus.emit.lastCall.args[0].previousOwnerId).to.equal(uuid2());

    await service.revoke(admin, "s1");
    expect(services.update.secondCall.args[1]).to.deep.equal({
      ownerId: null,
    });
  });

  it("delete и статистика: события несут владельца и создателя", async () => {
    services.findWithRelations.resolves(
      makeSocks({ ownerId: uuid2(), createdById: uuid3() }),
    );
    await service.delete(admin, "s1");
    expect(eventBus.emit.lastCall.args[0]).to.include({
      serviceId: "s1",
      ownerId: uuid2(),
      createdById: uuid3(),
    });

    services.find.resolves([
      { id: "s1", ownerId: uuid2(), createdById: uuid3() },
    ]);
    await service.recordStats(uuid2(), [
      { id: "s1", connections: 1, rxBytes: 10, txBytes: 20 },
      { id: "foreign", connections: 1, rxBytes: 10, txBytes: 20 },
    ]);
    expect(eventBus.emit.lastCall.args[0]).to.include({
      serviceId: "s1",
      ownerId: uuid2(),
      createdById: uuid3(),
    });
  });
});
