import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Агенты на протоколе HTTPS + SSE (ядро `src/core/agent`): ключ агента (хеш секрета), желаемое
 * (настройки воркеров с версиями, наблюдение), команды с итогами, история событий и метрик;
 * удалённый агент остаётся отозванной записью (`deleted_at`). Прежние агенты не переносятся:
 * ноды — `created` без агента, агента ставят заново (команда установки ноды); имя, адрес,
 * владельцы, интерфейсы, пиры и вся конфигурация остаются и уходят новому агенту при
 * регистрации. Право `agent:fetch` заменяется `agent:command`.
 */
export class AgentProtocol1792100000000 implements MigrationInterface {
  name = "AgentProtocol1792100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agent_events", "agent_configs", "agents" CASCADE`,
    );
    await queryRunner.query(
      `UPDATE "wg_nodes" SET "agent_id" = NULL, "status" = 'created', "status_message" = NULL, "applied_version" = 0, "apply_error" = NULL, "agent_version" = NULL, "agent_remote_ip" = NULL, "last_seen_at" = NULL`,
    );
    await queryRunner.query(
      `UPDATE "wg_interfaces" SET "status" = 'unknown', "status_message" = NULL`,
    );
    await queryRunner.query(
      `UPDATE "wg_interface_replicas" SET "status" = 'unknown', "status_message" = NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "agents" (
        "id" varchar(32) PRIMARY KEY,
        "name" varchar(128) NOT NULL,
        "labels" jsonb NOT NULL DEFAULT '{}',
        "token_labels" jsonb NOT NULL DEFAULT '{}',
        "secret_hash" varchar(64) NOT NULL,
        "pending_secret_hash" varchar(64),
        "host" jsonb,
        "hello" jsonb,
        "state" jsonb,
        "metrics" jsonb,
        "desired_rev" bigint NOT NULL DEFAULT 1,
        "watch" jsonb,
        "stream_instance" varchar(128),
        "last_seen_at" timestamptz,
        "remote_ip" varchar(64),
        "revoked_at" timestamptz,
        "deleted_at" timestamptz,
        "enroll_token_id" uuid,
        "enrolled_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENTS_ENROLLED" ON "agents" ("enrolled_at")`);

    await queryRunner.query(`
      CREATE TABLE "agent_configs" (
        "agent_id" varchar(32) NOT NULL,
        "worker" varchar(32) NOT NULL,
        "key" varchar(32) NOT NULL,
        "version" bigint NOT NULL,
        "data" jsonb,
        "actor" varchar(255),
        "updated_at" timestamptz NOT NULL,
        PRIMARY KEY ("agent_id", "worker", "key")
      )`);

    await queryRunner.query(`
      CREATE TABLE "agent_commands" (
        "seq" bigserial PRIMARY KEY,
        "id" varchar(64) NOT NULL,
        "agent_id" varchar(32) NOT NULL,
        "type" varchar(64) NOT NULL,
        "args" jsonb,
        "worker" varchar(32),
        "worker_type" varchar(64),
        "deadline_at" timestamptz,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "ok" boolean,
        "result" jsonb,
        "error" jsonb,
        "progress" real,
        "progress_text" varchar(200),
        "actor" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_AGENT_COMMANDS_ID" ON "agent_commands" ("id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_AGENT_COMMANDS_AGENT_PENDING" ON "agent_commands" ("agent_id", "status", "seq")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_COMMANDS_FINISHED" ON "agent_commands" ("finished_at")`);

    await queryRunner.query(`
      CREATE TABLE "agent_events" (
        "agent_id" varchar(32) NOT NULL,
        "id" varchar(128) NOT NULL,
        "worker" varchar(32) NOT NULL,
        "type" varchar(64) NOT NULL,
        "data" jsonb,
        "problems" jsonb,
        "at" bigint NOT NULL,
        "received_at" bigint NOT NULL,
        PRIMARY KEY ("agent_id", "id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_RECEIVED" ON "agent_events" ("received_at", "id")`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_AGENT" ON "agent_events" ("agent_id", "received_at")`);

    await queryRunner.query(`
      CREATE TABLE "agent_metrics" (
        "id" bigserial PRIMARY KEY,
        "agent_id" varchar(32) NOT NULL,
        "at" bigint NOT NULL,
        "host" jsonb,
        "workers" jsonb
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_METRICS_AGENT_AT" ON "agent_metrics" ("agent_id", "at")`);

    await this.rename(queryRunner, "agent:fetch", "agent:command");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.rename(queryRunner, "agent:command", "agent:fetch");
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agent_events", "agent_metrics", "agent_commands", "agent_configs", "agents" CASCADE`,
    );
    await queryRunner.query(`UPDATE "wg_nodes" SET "agent_id" = NULL, "status" = 'created'`);
    // Прежние таблицы — пустыми: агенты регистрируются заново.
    await queryRunner.query(`CREATE TABLE "agents" ("id" character varying(64) NOT NULL, "rev" bigint NOT NULL, "name" character varying(128) NOT NULL, "enrolled_at" bigint NOT NULL, "record" jsonb NOT NULL, CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENTS_ENROLLED" ON "agents" ("enrolled_at", "id")`);
    await queryRunner.query(`CREATE TABLE "agent_configs" ("agent_id" character varying(64) NOT NULL, "worker" character varying(32) NOT NULL, "key" character varying(32) NOT NULL, "version" bigint NOT NULL, "data" jsonb, "updated_at" bigint NOT NULL, "actor" character varying(255), CONSTRAINT "PK_3f1502be21e7f2d05773df56117" PRIMARY KEY ("agent_id", "worker", "key"))`);
    await queryRunner.query(`CREATE TABLE "agent_events" ("agent_id" character varying(64) NOT NULL, "id" character varying(64) NOT NULL, "worker" character varying(32) NOT NULL, "type" character varying(64) NOT NULL, "data" jsonb, "problems" jsonb, "at" bigint NOT NULL, "received_at" bigint NOT NULL, CONSTRAINT "PK_f9b070d71a9f804c875455289db" PRIMARY KEY ("agent_id", "id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_AGENT_RECEIVED" ON "agent_events" ("agent_id", "received_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_RECEIVED" ON "agent_events" ("received_at", "id")`);
  }

  /** Право `from` → `to` у ролей, пользователей и API-ключей; `from` удаляется. */
  private async rename(queryRunner: QueryRunner, from: string, to: string): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name") VALUES ($1) ON CONFLICT ("name") DO NOTHING`,
      [to],
    );
    for (const table of ["role_permissions", "user_permissions"]) {
      const owner = table === "role_permissions" ? "role_id" : "user_id";

      await queryRunner.query(
        `INSERT INTO "${table}" ("${owner}", "permission_id")
         SELECT link."${owner}", target."id"
         FROM "${table}" link
         JOIN "permissions" source ON source."id" = link."permission_id" AND source."name" = $1
         JOIN "permissions" target ON target."name" = $2
         ON CONFLICT DO NOTHING`,
        [from, to],
      );
    }
    await queryRunner.query(
      `UPDATE "api_keys"
       SET "scopes" = ARRAY(SELECT DISTINCT unnest(array_replace("scopes", $1, $2)))
       WHERE $1 = ANY("scopes")`,
      [from, to],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [from]);
  }
}
