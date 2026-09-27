import "reflect-metadata";

import { expect } from "chai";
import sinon from "sinon";

import {
  createMockEventBus,
  createMockRepository,
  uuid,
} from "../../test/helpers";
import { WgNodeHostChangedEvent, WgNodeStatusChangedEvent } from "./events";
import { WgNodeService } from "./wg-node.service";
import { EWgNodeStatus, wgAgentScope } from "./wg-node.types";

const makeNode = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(),
  name: "node-1",
  description: null,
  publicHost: "1.2.3.4",
  status: EWgNodeStatus.Created,
  agentKeyId: null,
  configVersion: 1,
  appliedVersion: 0,
  applyError: null,
  agentVersion: null,
  wgVersion: null,
  osInfo: null,
  lastSeenAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("WgNodeService", () => {
  let service: WgNodeService;
  let repo: ReturnType<typeof createMockRepository>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let apiKeys: { create: sinon.SinonStub; revoke: sinon.SinonStub };

  beforeEach(() => {
    repo = createMockRepository();
    eventBus = createMockEventBus();
    apiKeys = {
      create: sinon.stub().resolves({
        apiKey: { id: uuid() },
        key: "prefix.secret",
      }),
      revoke: sinon.stub().resolves(),
    };
    service = new WgNodeService(repo as any, apiKeys as any, eventBus as any);
  });

  it("create: создаёт ноду и агентский ключ со scope wg-agent:<id>", async () => {
    const node = makeNode();

    repo.createAndSave.resolves(node);
    repo.update.resolves({});

    const created = await service.create(uuid(), {
      name: "node-1",
      publicHost: "1.2.3.4",
    });

    expect(created.agentKey).to.equal("prefix.secret");
    expect(apiKeys.create.firstCall.args[1].scopes).to.deep.equal([
      wgAgentScope(node.id),
    ]);
    expect(eventBus.emit.calledOnce).to.be.true;
  });

  it("create: при сбое выпуска ключа нода удаляется", async () => {
    const node = makeNode();

    repo.createAndSave.resolves(node);
    apiKeys.create.rejects(new Error("boom"));

    try {
      await service.create(uuid(), { name: "node-1" });
      expect.fail("должно было упасть");
    } catch {
      expect(repo.delete.calledWith({ id: node.id })).to.be.true;
    }
  });

  it("rotateAgentKey: отзывает старый ключ и выпускает новый", async () => {
    const oldKeyId = uuid();
    const node = makeNode({ agentKeyId: oldKeyId });

    repo.findOne.resolves(node);
    repo.update.resolves({});

    const result = await service.rotateAgentKey(uuid(), node.id);

    expect(apiKeys.revoke.calledWith(oldKeyId)).to.be.true;
    expect(result.agentKey).to.equal("prefix.secret");
    expect(result.installCommand).to.match(
      /^curl -fsSL \S+\/api\/v1\/wg-agent\/install\.sh \| sudo sh -s -- --key 'prefix\.secret'$/,
    );
  });

  it("findByAgentScopes: чужие scopes — 403", async () => {
    repo.findOne.resolves(null);

    try {
      await service.findByAgentScopes(["worker:demo"]);
      expect.fail("должно было упасть");
    } catch (err: any) {
      expect(err.code).to.equal("WG_NODE_AGENT_SCOPE_INVALID");
    }
  });

  it("reportAgentState: appliedVersion не откатывается назад", async () => {
    const node = makeNode({ appliedVersion: 5 }) as any;

    repo.update.resolves({});
    repo.findOne.resolves(node);

    await service.reportAgentState(node, { appliedVersion: 3 });

    expect(repo.update.called).to.equal(false);
  });

  it("reportAgentState: не перезаписывает configVersion, поднятый параллельно", async () => {
    // Отчёт агента пишется точечным UPDATE: полный save сущности вернул бы
    // configVersion поверх bump-а из параллельной транзакции.
    const node = makeNode({ configVersion: 4, appliedVersion: 3 }) as any;

    repo.update.resolves({});
    repo.findOne.resolves({ ...node, configVersion: 5, appliedVersion: 4 });

    await service.reportAgentState(node, {
      appliedVersion: 4,
      agentVersion: "2.0.0",
    });

    expect(repo.save.called).to.equal(false);
    expect(repo.update.calledOnce).to.equal(true);
    expect(repo.update.firstCall.args[1]).to.deep.equal({
      appliedVersion: 4,
      agentVersion: "2.0.0",
    });
    expect(eventBus.emit.lastCall.args[0].node.configVersion).to.equal(5);
  });

  it("update: пишет только изменённые поля", async () => {
    const node = makeNode({ configVersion: 4 });

    repo.findOne.onFirstCall().resolves(node);
    repo.findOne
      .onSecondCall()
      .resolves({ ...node, configVersion: 5, name: "n" });
    repo.update.resolves({});

    const dto = await service.update(node.id, { name: "n" });

    expect(repo.save.called).to.equal(false);
    expect(repo.update.firstCall.args[1]).to.deep.equal({ name: "n" });
    expect(dto.configVersion).to.equal(5);
  });

  it("touchAgent: сохраняет IP, с которого пришёл агент, только при смене", async () => {
    const node = makeNode({
      status: EWgNodeStatus.Online,
      agentRemoteIp: "203.0.113.5",
    }) as any;

    repo.update.resolves({});

    await service.touchAgent(node, "198.51.100.9");
    expect(repo.update.lastCall.args[1].agentRemoteIp).to.equal("198.51.100.9");

    await service.touchAgent(node, "198.51.100.9");
    expect(repo.update.lastCall.args[1]).to.not.have.property("agentRemoteIp");
  });

  it("update: смена publicHost — событие для пересборки конфигураций связанных нод", async () => {
    // Релей и цели получают новый адрес сразу, а не при следующем изменении.
    const node = makeNode({ publicHost: "203.0.113.1" });

    repo.findOne.resolves(node);
    repo.update.resolves({});

    await service.update(node.id, { publicHost: "203.0.113.2" });
    await service.update(node.id, { description: "без смены адреса" });

    const hostEvents = eventBus.emit
      .getCalls()
      .map(call => call.args[0])
      .filter(event => event instanceof WgNodeHostChangedEvent);

    expect(hostEvents).to.have.length(1);
    expect(hostEvents[0].nodeId).to.equal(node.id);
  });

  it("failProvisioning: только нода в provisioning переходит в error", async () => {
    const provisioning = makeNode({ status: EWgNodeStatus.Provisioning });
    const online = makeNode({ status: EWgNodeStatus.Online });

    repo.findOne.onFirstCall().resolves(provisioning);
    repo.findOne.onSecondCall().resolves(online);
    repo.update.resolves({});

    await service.failProvisioning(provisioning.id);
    await service.failProvisioning(online.id);

    expect(repo.update.callCount).to.equal(1);
    expect(repo.update.firstCall.args[1]).to.deep.equal({
      status: EWgNodeStatus.Error,
    });
  });

  it("touchAgent: молчавшая нода становится online с событием", async () => {
    const node = makeNode({ status: EWgNodeStatus.Offline }) as any;

    repo.update.resolves({});

    await service.touchAgent(node);

    expect(node.status).to.equal(EWgNodeStatus.Online);
    expect(eventBus.emit.calledOnce).to.be.true;
  });

  describe("отметка offline", () => {
    it("sweepSilentAgents: событие несёт ноду из БД, а не сырые строки UPDATE", async () => {
      const node = makeNode({ status: EWgNodeStatus.Offline, name: "edge-1" });

      Object.assign(repo, {
        markSilentOffline: sinon.stub().resolves([node.id]),
      });
      repo.find.resolves([node]);

      expect(await service.sweepSilentAgents(90)).to.equal(1);

      const event = eventBus.emit.firstCall.args[0];

      expect(event).to.be.instanceOf(WgNodeStatusChangedEvent);
      expect(event.node).to.include({
        id: node.id,
        name: "edge-1",
        status: "offline",
      });
    });

    it("markOfflineIfSilent: только эта нода и только если молчит", async () => {
      const node = makeNode({ status: EWgNodeStatus.Offline });
      const since = new Date();

      const markSilentOffline = sinon.stub().resolves([node.id]);

      Object.assign(repo, { markSilentOffline });
      repo.find.resolves([node]);

      expect(await service.markOfflineIfSilent(node.id, since)).to.equal(true);
      expect(markSilentOffline.firstCall.args).to.deep.equal([since, node.id]);

      markSilentOffline.resolves([]);
      eventBus.emit.resetHistory();
      expect(await service.markOfflineIfSilent(node.id, since)).to.equal(false);
      expect(eventBus.emit.called).to.equal(false);
    });
  });
});
