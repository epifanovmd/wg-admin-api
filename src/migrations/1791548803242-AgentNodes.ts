import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Агенты на agent-sdk: хранилище SDK (агенты, настройки воркеров), токены
 * регистрации, события воркеров; нода привязывается к агенту (`agent_id`).
 * Команды нод и ключи агентов (api-ключи со scope `wg-agent:<nodeId>`) не
 * нужны: команды — запросы к воркеру через агента, связь — ключ агента SDK.
 * Нод с агентами нет: каждая — `created`, агента ставят заново (команда
 * установки ноды); имя, адрес, владельцы и вся конфигурация в БД
 * сохраняются и уходят новому агенту при регистрации.
 */
export class AgentNodes1791548803242 implements MigrationInterface {
    name = 'AgentNodes1791548803242'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "agent_enrollment_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "prefix" character varying(8) NOT NULL, "hash" character varying(64) NOT NULL, "labels" jsonb NOT NULL DEFAULT '{}', "max_uses" integer, "uses" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cb5de0c6535594a7e3d03276735" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_AGENT_ENROLLMENT_TOKENS_CREATED" ON "agent_enrollment_tokens"  ("created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_AGENT_ENROLLMENT_TOKENS_PREFIX" ON "agent_enrollment_tokens"  ("prefix") `);
        await queryRunner.query(`CREATE TABLE "agent_events" ("agent_id" character varying(64) NOT NULL, "id" character varying(64) NOT NULL, "worker" character varying(32) NOT NULL, "type" character varying(64) NOT NULL, "data" jsonb, "problems" jsonb, "at" bigint NOT NULL, "received_at" bigint NOT NULL, CONSTRAINT "PK_f9b070d71a9f804c875455289db" PRIMARY KEY ("agent_id", "id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_AGENT_RECEIVED" ON "agent_events"  ("agent_id", "received_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_AGENT_EVENTS_RECEIVED" ON "agent_events"  ("received_at", "id") `);
        await queryRunner.query(`CREATE TABLE "agents" ("id" character varying(64) NOT NULL, "rev" bigint NOT NULL, "name" character varying(128) NOT NULL, "enrolled_at" bigint NOT NULL, "record" jsonb NOT NULL, CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_AGENTS_ENROLLED" ON "agents"  ("enrolled_at", "id") `);
        await queryRunner.query(`CREATE TABLE "agent_configs" ("agent_id" character varying(64) NOT NULL, "worker" character varying(32) NOT NULL, "key" character varying(32) NOT NULL, "version" bigint NOT NULL, "data" jsonb, "updated_at" bigint NOT NULL, "actor" character varying(255), CONSTRAINT "PK_3f1502be21e7f2d05773df56117" PRIMARY KEY ("agent_id", "worker", "key"))`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS wg_node_commands_insert_notify ON wg_node_commands`);
        await queryRunner.query(`DROP TABLE "wg_node_commands"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_type_enum"`);
        await queryRunner.query(`UPDATE "api_keys" SET "revoked_at" = now() WHERE "revoked_at" IS NULL AND EXISTS (SELECT 1 FROM unnest("scopes") AS scope WHERE scope LIKE 'wg-agent:%')`);
        await queryRunner.query(`UPDATE "wg_nodes" SET "status" = 'created', "applied_version" = 0, "apply_error" = NULL, "agent_version" = NULL, "wg_version" = NULL, "os_info" = NULL, "agent_remote_ip" = NULL, "last_seen_at" = NULL`);
        await queryRunner.query(`UPDATE "wg_interfaces" SET "status" = 'unknown', "status_message" = NULL`);
        await queryRunner.query(`UPDATE "wg_interface_replicas" SET "status" = 'unknown', "status_message" = NULL`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "agent_key_id"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "agent_code_hash"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "status_message" text`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "agent_id" character varying(64)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_NODES_AGENT" ON "wg_nodes"  ("agent_id") WHERE agent_id IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODES_AGENT"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "agent_id"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "status_message"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "agent_code_hash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "agent_key_id" uuid`);
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_type_enum" AS ENUM('interface-restart', 'agent-logs', 'agent-update')`);
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_status_enum" AS ENUM('pending', 'running', 'succeeded', 'failed', 'timeout')`);
        await queryRunner.query(`CREATE TABLE "wg_node_commands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "node_id" uuid NOT NULL, "type" "public"."wg_node_commands_type_enum" NOT NULL, "status" "public"."wg_node_commands_status_enum" NOT NULL DEFAULT 'pending', "payload" jsonb NOT NULL DEFAULT '{}', "output" text NOT NULL DEFAULT '', "exit_code" integer, "error" text, "requested_by" uuid, "timeout_sec" integer NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_67c9754cb4b958ac97fb58a0d9a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_COMMANDS_STATUS" ON "wg_node_commands"  ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_COMMANDS_NODE_CREATED" ON "wg_node_commands"  ("node_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ADD CONSTRAINT "FK_a2040d8c0ebd362543c18b8439f" FOREIGN KEY ("node_id") REFERENCES "wg_nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ADD CONSTRAINT "FK_a0d742ea3620c180d0bf06e2dbd" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TRIGGER wg_node_commands_insert_notify AFTER INSERT ON wg_node_commands FOR EACH ROW EXECUTE FUNCTION wg_notify_node_changed('node_id')`);
        await queryRunner.query(`DROP TABLE "agent_configs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_AGENTS_ENROLLED"`);
        await queryRunner.query(`DROP TABLE "agents"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_AGENT_EVENTS_RECEIVED"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_AGENT_EVENTS_AGENT_RECEIVED"`);
        await queryRunner.query(`DROP TABLE "agent_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_AGENT_ENROLLMENT_TOKENS_PREFIX"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_AGENT_ENROLLMENT_TOKENS_CREATED"`);
        await queryRunner.query(`DROP TABLE "agent_enrollment_tokens"`);
    }

}
