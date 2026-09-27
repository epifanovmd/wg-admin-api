import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWireguard1790436553205 implements MigrationInterface {
    name = 'CreateWireguard1790436553205'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_nodes_status_enum" AS ENUM('created', 'provisioning', 'online', 'offline', 'error')`);
        await queryRunner.query(`CREATE TABLE "wg_nodes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "description" text, "public_host" character varying(255), "status" "public"."wg_nodes_status_enum" NOT NULL DEFAULT 'created', "agent_key_id" uuid, "config_version" bigint NOT NULL DEFAULT '1', "applied_version" bigint NOT NULL DEFAULT '0', "apply_error" text, "agent_version" character varying(32), "wg_version" character varying(64), "os_info" jsonb, "last_seen_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_62f117bb12ddd825ac6f75a3379" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODES_STATUS" ON "wg_nodes"  ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_NODES_NAME" ON "wg_nodes"  ("name") `);
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_type_enum" AS ENUM('shell', 'interface-restart', 'agent-logs')`);
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_status_enum" AS ENUM('pending', 'running', 'succeeded', 'failed', 'timeout')`);
        await queryRunner.query(`CREATE TABLE "wg_node_commands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "node_id" uuid NOT NULL, "type" "public"."wg_node_commands_type_enum" NOT NULL, "status" "public"."wg_node_commands_status_enum" NOT NULL DEFAULT 'pending', "payload" jsonb NOT NULL DEFAULT '{}', "output" text NOT NULL DEFAULT '', "exit_code" integer, "error" text, "requested_by" uuid, "timeout_sec" integer NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_67c9754cb4b958ac97fb58a0d9a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_COMMANDS_STATUS" ON "wg_node_commands"  ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_COMMANDS_NODE_CREATED" ON "wg_node_commands"  ("node_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."wg_endpoints_mode_enum" AS ENUM('direct', 'relay')`);
        await queryRunner.query(`CREATE TYPE "public"."wg_endpoints_forward_mode_enum" AS ENUM('dnat', 'ipip')`);
        await queryRunner.query(`CREATE TABLE "wg_endpoints" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "description" text, "host" character varying(255) NOT NULL, "mode" "public"."wg_endpoints_mode_enum" NOT NULL, "relay_node_id" uuid, "forward_mode" "public"."wg_endpoints_forward_mode_enum" NOT NULL DEFAULT 'dnat', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_734844f11fddd74bc5ce15361cf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_ENDPOINTS_NAME" ON "wg_endpoints"  ("name") `);
        await queryRunner.query(`CREATE TABLE "wg_relay_links" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "relay_node_id" uuid NOT NULL, "target_node_id" uuid NOT NULL, "tunnel_index" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_02cc758d806902187b8e3748ee8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_RELAY_LINKS_TUNNEL" ON "wg_relay_links"  ("tunnel_index") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_RELAY_LINKS_PAIR" ON "wg_relay_links"  ("relay_node_id", "target_node_id") `);
        await queryRunner.query(`CREATE TYPE "public"."wg_interfaces_status_enum" AS ENUM('up', 'down', 'error', 'unknown')`);
        await queryRunner.query(`CREATE TABLE "wg_interfaces" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "node_id" uuid NOT NULL, "name" character varying(15) NOT NULL, "listen_port" integer NOT NULL, "address_cidr" character varying(43) NOT NULL, "address_v6_cidr" character varying(64), "private_key_enc" text NOT NULL, "public_key" character varying(64) NOT NULL, "dns" character varying(255), "mtu" integer, "endpoint_id" uuid, "endpoint_port" integer, "nat_enabled" boolean NOT NULL DEFAULT true, "custom_post_up" text, "custom_post_down" text, "enabled" boolean NOT NULL DEFAULT true, "status" "public"."wg_interfaces_status_enum" NOT NULL DEFAULT 'unknown', "status_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ed5179bb399ba96c87a5709932d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_INTERFACES_NODE_PORT" ON "wg_interfaces"  ("node_id", "listen_port") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_INTERFACES_NODE_NAME" ON "wg_interfaces"  ("node_id", "name") `);
        await queryRunner.query(`CREATE TABLE "wg_node_metrics" ("id" BIGSERIAL NOT NULL, "node_id" uuid NOT NULL, "ts" TIMESTAMP WITH TIME ZONE NOT NULL, "cpu_percent" real NOT NULL, "load1" real NOT NULL, "mem_used_bytes" bigint NOT NULL, "mem_total_bytes" bigint NOT NULL, "disk_used_bytes" bigint NOT NULL, "disk_total_bytes" bigint NOT NULL, "uptime_sec" bigint NOT NULL, CONSTRAINT "PK_5b5fa8ff8a9525822ad193fad15" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_METRICS_TS" ON "wg_node_metrics"  ("ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODE_METRICS_NODE_TS" ON "wg_node_metrics"  ("node_id", "ts") `);
        await queryRunner.query(`CREATE TABLE "wg_stat_hours" ("id" BIGSERIAL NOT NULL, "peer_id" uuid NOT NULL, "interface_id" uuid NOT NULL, "node_id" uuid NOT NULL, "user_id" uuid, "ts" TIMESTAMP WITH TIME ZONE NOT NULL, "rx_delta" bigint NOT NULL, "tx_delta" bigint NOT NULL, "rx_peak_bps" bigint NOT NULL, "tx_peak_bps" bigint NOT NULL, "online_ratio" real NOT NULL, CONSTRAINT "PK_117f7412b8e0cacc172e02e44b8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_HOURS_TS" ON "wg_stat_hours"  ("ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_HOURS_NODE_TS" ON "wg_stat_hours"  ("node_id", "ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_HOURS_IFACE_TS" ON "wg_stat_hours"  ("interface_id", "ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_HOURS_PEER_TS" ON "wg_stat_hours"  ("peer_id", "ts") `);
        await queryRunner.query(`CREATE TABLE "wg_stat_samples" ("id" BIGSERIAL NOT NULL, "peer_id" uuid NOT NULL, "interface_id" uuid NOT NULL, "node_id" uuid NOT NULL, "user_id" uuid, "ts" TIMESTAMP WITH TIME ZONE NOT NULL, "rx_total" bigint NOT NULL, "tx_total" bigint NOT NULL, "rx_delta" bigint NOT NULL, "tx_delta" bigint NOT NULL, "rx_peak_bps" bigint NOT NULL, "tx_peak_bps" bigint NOT NULL, "online" boolean NOT NULL, CONSTRAINT "PK_6a67898ede5733b66b99e8536c3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_SAMPLES_TS" ON "wg_stat_samples"  ("ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_SAMPLES_NODE_TS" ON "wg_stat_samples"  ("node_id", "ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_SAMPLES_IFACE_TS" ON "wg_stat_samples"  ("interface_id", "ts") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_STAT_SAMPLES_PEER_TS" ON "wg_stat_samples"  ("peer_id", "ts") `);
        await queryRunner.query(`CREATE TYPE "public"."wg_peers_disabled_reason_enum" AS ENUM('manual', 'expired')`);
        await queryRunner.query(`CREATE TABLE "wg_peers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "interface_id" uuid NOT NULL, "user_id" uuid, "name" character varying(120) NOT NULL, "description" text, "public_key" character varying(64) NOT NULL, "private_key_enc" text, "preshared_key_enc" text, "address_v4" character varying(15) NOT NULL, "address_v6" character varying(45), "client_allowed_ips" character varying(500) NOT NULL, "client_dns" character varying(255), "client_mtu" integer, "persistent_keepalive" integer NOT NULL DEFAULT '25', "enabled" boolean NOT NULL DEFAULT true, "disabled_reason" "public"."wg_peers_disabled_reason_enum", "expires_at" TIMESTAMP WITH TIME ZONE, "last_handshake_at" TIMESTAMP WITH TIME ZONE, "last_endpoint" character varying(64), "rx_bytes_total" bigint NOT NULL DEFAULT '0', "tx_bytes_total" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ed217100641c94775702e89a689" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_PEERS_USER" ON "wg_peers"  ("user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_PEERS_IFACE_ADDRESS" ON "wg_peers"  ("interface_id", "address_v4") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_PEERS_IFACE_PUBKEY" ON "wg_peers"  ("interface_id", "public_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_PEERS_IFACE_NAME" ON "wg_peers"  ("interface_id", "name") `);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ADD CONSTRAINT "FK_a2040d8c0ebd362543c18b8439f" FOREIGN KEY ("node_id") REFERENCES "wg_nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ADD CONSTRAINT "FK_a0d742ea3620c180d0bf06e2dbd" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD CONSTRAINT "FK_5b1f4bbe2a6bbbdaf2b1b5a1eeb" FOREIGN KEY ("relay_node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_relay_links" ADD CONSTRAINT "FK_39d2677a92f2eb988fe5313aa94" FOREIGN KEY ("relay_node_id") REFERENCES "wg_nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_relay_links" ADD CONSTRAINT "FK_7970cafdd8b54ad51f8c7c9903c" FOREIGN KEY ("target_node_id") REFERENCES "wg_nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD CONSTRAINT "FK_01088de778f98569dfd554a6ea2" FOREIGN KEY ("node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD CONSTRAINT "FK_6ba1c7330cabafa848246949554" FOREIGN KEY ("endpoint_id") REFERENCES "wg_endpoints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_peers" ADD CONSTRAINT "FK_e949ae87e1835b3fb3b27d511fb" FOREIGN KEY ("interface_id") REFERENCES "wg_interfaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_peers" ADD CONSTRAINT "FK_beb70f4b0ebe2e3701b15a41a1f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_peers" DROP CONSTRAINT "FK_beb70f4b0ebe2e3701b15a41a1f"`);
        await queryRunner.query(`ALTER TABLE "wg_peers" DROP CONSTRAINT "FK_e949ae87e1835b3fb3b27d511fb"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP CONSTRAINT "FK_6ba1c7330cabafa848246949554"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP CONSTRAINT "FK_01088de778f98569dfd554a6ea2"`);
        await queryRunner.query(`ALTER TABLE "wg_relay_links" DROP CONSTRAINT "FK_7970cafdd8b54ad51f8c7c9903c"`);
        await queryRunner.query(`ALTER TABLE "wg_relay_links" DROP CONSTRAINT "FK_39d2677a92f2eb988fe5313aa94"`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP CONSTRAINT "FK_5b1f4bbe2a6bbbdaf2b1b5a1eeb"`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" DROP CONSTRAINT "FK_a0d742ea3620c180d0bf06e2dbd"`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" DROP CONSTRAINT "FK_a2040d8c0ebd362543c18b8439f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_PEERS_IFACE_NAME"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_PEERS_IFACE_PUBKEY"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_PEERS_IFACE_ADDRESS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_PEERS_USER"`);
        await queryRunner.query(`DROP TABLE "wg_peers"`);
        await queryRunner.query(`DROP TYPE "public"."wg_peers_disabled_reason_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_SAMPLES_PEER_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_SAMPLES_IFACE_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_SAMPLES_NODE_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_SAMPLES_TS"`);
        await queryRunner.query(`DROP TABLE "wg_stat_samples"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_HOURS_PEER_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_HOURS_IFACE_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_HOURS_NODE_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_STAT_HOURS_TS"`);
        await queryRunner.query(`DROP TABLE "wg_stat_hours"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODE_METRICS_NODE_TS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODE_METRICS_TS"`);
        await queryRunner.query(`DROP TABLE "wg_node_metrics"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_INTERFACES_NODE_NAME"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_INTERFACES_NODE_PORT"`);
        await queryRunner.query(`DROP TABLE "wg_interfaces"`);
        await queryRunner.query(`DROP TYPE "public"."wg_interfaces_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_RELAY_LINKS_PAIR"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_RELAY_LINKS_TUNNEL"`);
        await queryRunner.query(`DROP TABLE "wg_relay_links"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_ENDPOINTS_NAME"`);
        await queryRunner.query(`DROP TABLE "wg_endpoints"`);
        await queryRunner.query(`DROP TYPE "public"."wg_endpoints_forward_mode_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_endpoints_mode_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODE_COMMANDS_NODE_CREATED"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODE_COMMANDS_STATUS"`);
        await queryRunner.query(`DROP TABLE "wg_node_commands"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODES_NAME"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODES_STATUS"`);
        await queryRunner.query(`DROP TABLE "wg_nodes"`);
        await queryRunner.query(`DROP TYPE "public"."wg_nodes_status_enum"`);
    }

}
