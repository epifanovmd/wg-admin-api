import "reflect-metadata";

import { expect } from "chai";
import { randomBytes, randomUUID } from "crypto";
import { DataSource } from "typeorm";

import { AppModule } from "../../app.module";
import { migrations } from "../../migrations";
import { collectEntities } from "../decorators";
import { Agent } from "./agent.entity";
import { AgentRepository } from "./agent.repository";
import { AgentIssue } from "./agent-issue.entity";
import { AgentIssueRepository } from "./agent-issue.repository";

/**
 * Запросы агентов на настоящем Postgres (`TEST_DATABASE_URL` — база с test или e2e в имени;
 * без неё набор пропускается): `UPDATE … RETURNING` и условные обновления.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("AgentRepository, AgentIssueRepository (Postgres, TEST_DATABASE_URL)", function () {
  this.timeout(60_000);

  let dataSource: DataSource;
  let agents: AgentRepository;
  let issues: AgentIssueRepository;

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
    await dataSource.runMigrations();
    agents = new AgentRepository(dataSource, Agent);
    issues = new AgentIssueRepository(dataSource, AgentIssue);
  });

  after(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("номер желаемого растёт и возвращается; сброс потоков копии — id её агентов", async () => {
    const id = randomBytes(16).toString("hex");
    const instance = `test:${randomUUID()}`;

    await dataSource.query(
      `INSERT INTO agents (id, name, secret_hash, stream_instance) VALUES ($1, 'a', 'h', $2)`,
      [id, instance],
    );
    const first = await agents.bumpDesired(id);

    expect(await agents.bumpDesired(id)).to.equal(first + 1);
    expect(await agents.bumpDesired(randomBytes(16).toString("hex"))).to.equal(
      0,
    );
    expect(await agents.clearStreams(instance)).to.deep.equal([id]);
    expect(await agents.clearStreams(instance)).to.deep.equal([]);
    await dataSource.query(`DELETE FROM agents WHERE id = $1`, [id]);
  });

  it("одноразовая ссылка занимается один раз и только до срока; возврат — снова можно", async () => {
    const params = {
      tokenName: "t",
      labels: {},
      maxUses: 1,
      tokenTtlMinutes: 60,
      server: "https://api.example.com",
    };
    const live = await issues.createAndSave({
      params,
      createdBy: null,
      expiresAt: new Date(Date.now() + 60_000),
      downloadedAt: null,
      tokenId: null,
    });
    const expired = await issues.createAndSave({
      params,
      createdBy: null,
      expiresAt: new Date(Date.now() - 1000),
      downloadedAt: null,
      tokenId: null,
    });
    const now = new Date();

    expect((await issues.claim(live.id, now))?.id).to.equal(live.id);
    expect(await issues.claim(live.id, now)).to.equal(null);
    await issues.release(live.id);
    expect((await issues.claim(live.id, now))?.id).to.equal(live.id);
    expect(await issues.claim(expired.id, now)).to.equal(null);
    expect(await issues.claim(randomUUID(), now)).to.equal(null);
  });
});
