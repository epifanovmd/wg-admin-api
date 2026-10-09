import "reflect-metadata";

import type { AgentRecord } from "agent-sdk/server";
import { expect } from "chai";
import { randomBytes } from "crypto";
import { DataSource } from "typeorm";

import { AppModule } from "../../../app.module";
import { collectEntities } from "../../../core";
import { migrations } from "../../../migrations";
import { agentConfig } from "../agent.config";
import { AgentWorkerEvent } from "../agent-worker-event.entity";
import { AgentWorkerEventRepository } from "../agent-worker-event.repository";
import { AgentStore } from "./agent.store";

/**
 * Хранилище агентов и история на настоящем Postgres:
 * `TEST_DATABASE_URL=postgres://…/<база с test или e2e в имени>`. Без
 * переменной набор пропускается. Схема `public` пересоздаётся миграциями.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const newAgentId = () => randomBytes(16).toString("hex");

const record = (patch: Partial<AgentRecord> = {}): AgentRecord => ({
  id: newAgentId(),
  name: "node-1",
  grantedLabels: {},
  labels: { zone: "a" },
  revoked: false,
  online: false,
  enrolledAt: Date.now(),
  secretHash: "ab".repeat(32),
  lastSeq: 0,
  configs: {},
  alerts: [],
  rev: 0,
  ...patch,
});

describe("AgentStore и история агентов (Postgres, TEST_DATABASE_URL)", function () {
  this.timeout(60_000);

  let dataSource: DataSource;
  let store: AgentStore;
  let events: AgentWorkerEventRepository;

  before(async function () {
    if (!DATABASE_URL) this.skip();
    if (!/e2e|test/i.test(new URL(DATABASE_URL).pathname)) {
      throw new Error("TEST_DATABASE_URL: база должна быть тестовой");
    }

    dataSource = new DataSource({
      type: "postgres",
      url: DATABASE_URL,
      entities: collectEntities(AppModule),
      migrations,
    });
    await dataSource.initialize();
    await dataSource.query(`DROP SCHEMA IF EXISTS public CASCADE`);
    await dataSource.query(`CREATE SCHEMA public`);
    await dataSource.runMigrations();
    store = new AgentStore(dataSource);
    events = new AgentWorkerEventRepository(dataSource, AgentWorkerEvent);
  });

  after(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("агент: запись целиком, незнакомые поля и \\u0000 — как есть (без NUL)", async () => {
    const agent = record({ name: "a\u0000b" });

    (agent as unknown as Record<string, unknown>).extra = { nested: [1, "x"] };
    await store.createAgent(agent);

    const read = (await store.getAgent(agent.id)) as AgentRecord &
      Record<string, unknown>;

    expect(read.name).to.equal("ab");
    expect(read.extra).to.deep.equal({ nested: [1, "x"] });
    expect(read.rev).to.equal(0);
    expect((await store.listAgents()).map(a => a.id)).to.include(agent.id);
  });

  it("условная запись по rev: устаревшая запись не затирает новую", async () => {
    const agent = record();

    await store.createAgent(agent);

    const first = (await store.getAgent(agent.id)) as AgentRecord;
    const second = (await store.getAgent(agent.id)) as AgentRecord;

    first.online = true;
    expect(await store.updateAgent(first)).to.equal(true);
    expect(first.rev).to.equal(1);

    second.name = "stale";
    expect(await store.updateAgent(second)).to.equal(false);
    expect(second.rev).to.equal(0);

    const read = (await store.getAgent(agent.id)) as AgentRecord;

    expect([read.rev, read.online, read.name]).to.deep.equal([
      1,
      true,
      "node-1",
    ]);
    expect(await store.updateAgent(record())).to.equal(false);
  });

  it("настройки: версия растёт, переживает удаление, minVersion; null — значение", async () => {
    const agentId = newAgentId();

    await store.createAgent(record({ id: agentId }));

    const v1 = await store.setConfig(agentId, "echo", "settings", { a: 1 });
    const v2 = await store.setConfig(agentId, "echo", "settings", null, {
      actor: "u1",
    });

    expect([v1.version, v2.version]).to.deep.equal([1, 2]);
    expect(v2).to.deep.include({ data: null, actor: "u1" });
    expect((await store.listConfigs(agentId)).map(c => c.data)).to.deep.equal([
      null,
    ]);

    expect(await store.deleteConfig(agentId, "echo", "settings")).to.equal(
      true,
    );
    expect(await store.deleteConfig(agentId, "echo", "settings")).to.equal(
      false,
    );
    expect(await store.listConfigs(agentId)).to.deep.equal([]);

    const v3 = await store.setConfig(agentId, "echo", "settings", { a: 3 });
    const v10 = await store.setConfig(agentId, "echo", "limits", 5, {
      minVersion: 10,
    });

    expect([v3.version, v10.version]).to.deep.equal([3, 10]);
  });

  it("настройки: одновременные записи получают разные версии", async () => {
    const agentId = newAgentId();

    await store.createAgent(record({ id: agentId }));

    const versions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.setConfig(agentId, "echo", "settings", { i }),
      ),
    );

    expect(new Set(versions.map(v => v.version)).size).to.equal(10);
  });

  it("удаление агента — вместе с настройками", async () => {
    const agentId = newAgentId();

    await store.createAgent(record({ id: agentId }));
    await store.setConfig(agentId, "echo", "settings", {});

    expect(await store.deleteAgent(agentId)).to.equal(true);
    expect(await store.deleteAgent(agentId)).to.equal(false);
    expect(await store.getAgent(agentId)).to.equal(undefined);
    expect(await store.listConfigs(agentId)).to.deep.equal([]);

    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM agent_configs WHERE agent_id = $1`,
      [agentId],
    );

    expect(count).to.equal(0);
  });

  it("события: повтор (агент, id) не задваивается; лента с фильтром и курсором", async () => {
    const agentId = newAgentId();
    const event = (id: string, receivedAt: number, type = "echo.progress") =>
      events.create({
        agentId,
        id,
        worker: "echo",
        type,
        data: { id },
        at: receivedAt,
        receivedAt,
      });

    expect(await events.insertIfNew(event("m1", 10))).to.equal(true);
    expect(await events.insertIfNew(event("m1", 10))).to.equal(false);
    await events.insertIfNew(event("m2", 20, "echo.done"));
    await events.insertIfNew(event("m3", 30));

    const page = await events.findFeed({ agentIds: [agentId], limit: 2 });

    expect(page.map(e => e.id)).to.deep.equal(["m3", "m2"]);
    expect(
      (
        await events.findFeed({
          agentIds: [agentId],
          before: { receivedAt: 20, id: "m2" },
          limit: 10,
        })
      ).map(e => e.id),
    ).to.deep.equal(["m1"]);
    expect(
      (
        await events.findFeed({
          agentIds: [agentId],
          type: "echo.done",
          limit: 10,
        })
      ).map(e => e.id),
    ).to.deep.equal(["m2"]);
    expect(await events.deleteReceivedBefore(15)).to.be.greaterThan(0);
  });

  it("настройки с AGENT_CONFIGS_KEY: в БД — зашифрованы, наружу — как есть", async function () {
    if (!agentConfig.configsKey) this.skip();

    const agentId = newAgentId();
    const data = { privateKey: "secret-key", peers: [1, 2] };
    const written = await store.setConfig(agentId, "wg", "state", data);

    expect(written.data).to.deep.equal(data);

    const [row] = await dataSource.query(
      `SELECT data FROM agent_configs WHERE agent_id = $1`,
      [agentId],
    );

    expect(JSON.stringify(row.data)).to.not.include("secret-key");
    expect(row.data.$sealed).to.match(/^v1:/);
    expect((await store.listConfigs(agentId))[0].data).to.deep.equal(data);
  });
});
