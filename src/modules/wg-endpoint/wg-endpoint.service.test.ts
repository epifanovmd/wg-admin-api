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
import { WgEndpointChangedEvent, WgEndpointUpdatedEvent } from "./events";
import { relayTunnelAddresses, relayTunnelCapacity } from "./relay-tunnel";
import { WgEndpointService } from "./wg-endpoint.service";
import { EWgEndpointMode } from "./wg-endpoint.types";

describe("relay-tunnel", () => {
  it("выделяет /30-блоки по индексу", () => {
    expect(relayTunnelAddresses("10.99.0.0/16", 0)).to.deep.equal({
      relayIp: "10.99.0.1",
      targetIp: "10.99.0.2",
      prefix: 30,
    });
    expect(relayTunnelAddresses("10.99.0.0/16", 1)).to.deep.equal({
      relayIp: "10.99.0.5",
      targetIp: "10.99.0.6",
      prefix: 30,
    });
    expect(relayTunnelAddresses("10.99.0.0/16", 64).relayIp).to.equal(
      "10.99.1.1",
    );
  });

  it("считает ёмкость и отклоняет переполнение", () => {
    expect(relayTunnelCapacity("10.99.0.0/30")).to.equal(1);
    expect(() => relayTunnelAddresses("10.99.0.0/30", 1)).to.throw();
  });
});

const admin = { userId: uuid(), roles: ["admin"], permissions: ["*"] } as any;
/** Только свои точки; ноды — все. */
const tenant = {
  userId: uuid3(),
  roles: ["user"],
  permissions: [
    "wg:node:view",
    "wg:endpoint:create",
    "wg:endpoint:view:own",
    "wg:endpoint:update:own",
  ],
} as any;

describe("WgEndpointService", () => {
  let service: WgEndpointService;
  let endpoints: ReturnType<typeof createMockRepository>;
  let links: ReturnType<typeof createMockRepository> & {
    findPair: sinon.SinonStub;
    findByRelay: sinon.SinonStub;
    findByTarget: sinon.SinonStub;
    nextTunnelIndex: sinon.SinonStub;
  };
  let eventBus: ReturnType<typeof createMockEventBus>;
  /** Отправленные события данного класса. */
  const emitted = <T>(type: new (...args: any[]) => T): T[] =>
    eventBus.emit
      .getCalls()
      .map(call => call.args[0])
      .filter((event): event is T => event instanceof type);
  let nodes: { findFor: sinon.SinonStub };
  let usage: {
    targetNodeIds: sinon.SinonStub;
    relayPortConflict: sinon.SinonStub;
    interfacesByEndpoint: sinon.SinonStub;
  };

  beforeEach(() => {
    endpoints = createMockRepository();
    links = {
      ...createMockRepository(),
      findPair: sinon.stub(),
      findByRelay: sinon.stub(),
      findByTarget: sinon.stub(),
      nextTunnelIndex: sinon.stub(),
    };
    eventBus = createMockEventBus();
    nodes = { findFor: sinon.stub().resolves({}) };
    usage = {
      interfacesByEndpoint: sinon.stub().resolves({}),
      targetNodeIds: sinon.stub().resolves([]),
      relayPortConflict: sinon.stub().resolves(false),
    };
    service = new WgEndpointService(
      endpoints as any,
      links as any,
      nodes as any,
      eventBus as any,
      [usage],
    );
  });

  it("create relay: требует релей-ноду", async () => {
    try {
      await service.create(admin, {
        name: "e1",
        host: "1.2.3.4",
        mode: EWgEndpointMode.Relay,
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_ENDPOINT_RELAY_NODE_REQUIRED");
    }
  });

  it("update: событие с прежним снапшотом при смене хоста", async () => {
    const endpoint = {
      id: uuid(),
      name: "e1",
      description: null,
      host: "old.example.com",
      mode: EWgEndpointMode.Direct,
      relayNodeId: null,
      forwardMode: "dnat",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    endpoints.findOne.resolves(endpoint);
    endpoints.save.callsFake(async (entity: any) => entity);

    await service.update(admin, endpoint.id, { host: "new.example.com" });

    const configEvents = emitted(WgEndpointUpdatedEvent);

    expect(configEvents).to.have.length(1);
    expect(configEvents[0].previous.host).to.equal("old.example.com");
    // Подписчикам UI — любое сохранение.
    expect(emitted(WgEndpointChangedEvent)).to.have.length(1);
  });

  it("update: релеем нельзя назначить ноду, чьи интерфейсы используют точку", async () => {
    const targetNodeId = uuid2();
    const endpoint = {
      id: uuid(),
      name: "relay",
      description: null,
      host: "198.51.100.10",
      mode: EWgEndpointMode.Direct,
      relayNodeId: null,
      forwardMode: "ipip",
    };

    endpoints.findOne.resolves(endpoint);
    endpoints.save.callsFake(async (entity: any) => entity);
    usage.targetNodeIds.withArgs(endpoint.id).resolves([targetNodeId]);

    try {
      await service.update(admin, endpoint.id, {
        mode: EWgEndpointMode.Relay,
        relayNodeId: targetNodeId,
      });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_ENDPOINT_RELAY_IS_TARGET");
    }
    expect(endpoints.save.called).to.be.false;
  });

  it("update: на новом релее порты интерфейсов точки заняты — 409", async () => {
    const relayNodeId = uuid2();
    const endpoint = {
      id: uuid(),
      name: "relay",
      description: null,
      host: "198.51.100.10",
      mode: EWgEndpointMode.Relay,
      relayNodeId: uuid(),
      forwardMode: "ipip",
    };

    endpoints.findOne.resolves(endpoint);
    usage.relayPortConflict.withArgs(endpoint.id, relayNodeId).resolves(true);

    try {
      await service.update(admin, endpoint.id, { relayNodeId });
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_ENDPOINT_RELAY_PORT_CONFLICT");
    }
    expect(endpoints.save.called).to.be.false;
  });

  it("update без конфигурационных изменений — без события", async () => {
    const endpoint = {
      id: uuid(),
      name: "e1",
      description: null,
      host: "host.example.com",
      mode: EWgEndpointMode.Direct,
      relayNodeId: null,
      forwardMode: "dnat",
    };

    endpoints.findOne.resolves(endpoint);
    endpoints.save.callsFake(async (entity: any) => entity);

    await service.update(admin, endpoint.id, { description: "note" });

    // Конфигурация нод не менялась — релеи не пересинхронизируются;
    // UI узнаёт о новом описании.
    expect(emitted(WgEndpointUpdatedEvent)).to.have.length(0);
    expect(emitted(WgEndpointChangedEvent)).to.have.length(1);
  });

  it("ensureLink: возвращает существующий линк", async () => {
    const link = { id: uuid(), tunnelIndex: 0 };

    links.findPair.resolves(link);

    expect(await service.ensureLink(uuid(), uuid2())).to.equal(link);
    expect(links.createAndSave.called).to.be.false;
  });

  it("ensureLink: создаёт линк со свободным индексом", async () => {
    links.findPair.resolves(null);
    links.nextTunnelIndex.resolves(3);
    links.createAndSave.callsFake(async (data: any) => data);

    const link = await service.ensureLink(uuid(), uuid2());

    expect(link.tunnelIndex).to.equal(3);
  });

  describe("область «все / свои»", () => {
    const makeEndpoint = (overrides: Record<string, unknown> = {}) => ({
      id: uuid(),
      ownerId: null,
      createdById: null,
      name: "e1",
      description: null,
      host: "h.example.com",
      mode: EWgEndpointMode.Direct,
      relayNodeId: null,
      forwardMode: "dnat",
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

    it("create: создатель — автор; релей проверяется на видимость актору", async () => {
      endpoints.createAndSave.callsFake(async (data: any) =>
        makeEndpoint(data),
      );

      await service.create(tenant, {
        name: "own",
        host: "h",
        mode: EWgEndpointMode.Relay,
        relayNodeId: uuid2(),
      });

      expect(endpoints.createAndSave.firstCall.args[0]).to.include({
        createdById: tenant.userId,
        ownerId: null,
      });
      expect(nodes.findFor.firstCall.args).to.deep.equal([
        tenant,
        uuid2(),
        "wg:node:view",
      ]);

      nodes.findFor.rejects(
        Object.assign(new Error("nf"), { code: "WG_NODE_NOT_FOUND" }),
      );
      await expectCode(
        () =>
          service.create(tenant, {
            name: "x",
            host: "h",
            mode: EWgEndpointMode.Relay,
            relayNodeId: uuid2(),
          }),
        "WG_ENDPOINT_RELAY_NODE_NOT_FOUND",
      );
    });

    it("create: чужой владелец без права назначения — 403", async () => {
      await expectCode(
        () =>
          service.create(tenant, {
            name: "x",
            host: "h",
            mode: EWgEndpointMode.Direct,
            ownerId: uuid(),
          }),
        "WG_ENDPOINT_FORBIDDEN",
      );
    });

    it("list и options: с областью own — только свои", async () => {
      const findPage = sinon.stub().resolves([[], 0]);

      Object.assign(endpoints, { findPage });
      await service.list(tenant, undefined, { offset: 0, limit: 20 });
      expect(findPage.firstCall.args[0].ownedBy).to.equal(tenant.userId);

      await service.options(tenant);
      expect(endpoints.find.firstCall.args[0].where).to.deep.equal([
        { ownerId: tenant.userId },
        { createdById: tenant.userId },
      ]);
    });

    it("get: чужая — 404; своя без права удаления — 403", async () => {
      endpoints.findOne.resolves(makeEndpoint({ ownerId: uuid2() }));
      await expectCode(
        () => service.get(tenant, uuid()),
        "WG_ENDPOINT_NOT_FOUND",
      );

      endpoints.findOne.resolves(makeEndpoint({ createdById: tenant.userId }));
      await service.get(tenant, uuid());
      await expectCode(
        () => service.delete(tenant, uuid()),
        "WG_ENDPOINT_FORBIDDEN",
      );
    });

    it("update: прежний релей не проверяется на видимость", async () => {
      endpoints.findOne.resolves(
        makeEndpoint({
          ownerId: tenant.userId,
          mode: EWgEndpointMode.Relay,
          relayNodeId: uuid2(),
        }),
      );
      endpoints.save.callsFake(async (entity: any) => entity);

      await service.update(tenant, uuid(), { name: "renamed" });

      expect(nodes.findFor.called).to.be.false;
    });

    it("assign и revoke: событие с прежним владельцем", async () => {
      endpoints.findOne.resolves(makeEndpoint({ ownerId: uuid2() }));

      await service.assign(admin, uuid(), { userId: uuid3() });
      expect(endpoints.update.lastCall.args[1]).to.deep.equal({
        ownerId: uuid3(),
      });
      expect(emitted(WgEndpointChangedEvent).at(-1)!.previousOwnerId).to.equal(
        uuid2(),
      );

      await service.revoke(admin, uuid());
      expect(endpoints.update.lastCall.args[1]).to.deep.equal({
        ownerId: null,
      });
    });

    it("delete: событие несёт владельца и создателя", async () => {
      endpoints.findOne.resolves(
        makeEndpoint({ ownerId: uuid2(), createdById: uuid3() }),
      );

      await service.delete(admin, uuid());

      expect(eventBus.emit.lastCall.args[0]).to.include({
        ownerId: uuid2(),
        createdById: uuid3(),
      });
    });
  });
});
