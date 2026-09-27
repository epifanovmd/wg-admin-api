import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWgSocks1790500000006 implements MigrationInterface {
    name = 'CreateWgSocks1790500000006'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "wg_socks_services" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "description" text, "node_id" uuid NOT NULL, "listen_port" integer NOT NULL, "client_host" character varying(253), "client_port" integer, "server_name" character varying(253) NOT NULL, "ca_cert_pem" text NOT NULL, "ca_key_enc" text, "server_cert_pem" text NOT NULL, "server_key_enc" text NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8b2f0ae23295d095ec80f58ad93" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_SOCKS_NODE_PORT" ON "wg_socks_services"  ("node_id", "listen_port") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_SOCKS_NAME" ON "wg_socks_services"  ("name") `);
        await queryRunner.query(`CREATE TABLE "wg_socks_users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "service_id" uuid NOT NULL, "username" character varying(64) NOT NULL, "password_enc" text NOT NULL, "password_salt" character varying(32) NOT NULL, "password_hash" character varying(64) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4aa1b16322b35a8b442cf06fd1f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_SOCKS_USERS_NAME" ON "wg_socks_users"  ("service_id", "username") `);
        await queryRunner.query(`CREATE TABLE "wg_socks_clients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "service_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "cert_pem" text NOT NULL, "key_enc" text, "fingerprint" character varying(64) NOT NULL, "revoked" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5f2630fe2d7dd1b14de721edd81" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_SOCKS_CLIENTS_FP" ON "wg_socks_clients"  ("service_id", "fingerprint") `);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ADD CONSTRAINT "FK_050ae42b7f0a8603b2851b2f541" FOREIGN KEY ("node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_socks_users" ADD CONSTRAINT "FK_082c838239e2f1ab2f9a6746335" FOREIGN KEY ("service_id") REFERENCES "wg_socks_services"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_socks_clients" ADD CONSTRAINT "FK_957d708aab093910f18bc7e9ac2" FOREIGN KEY ("service_id") REFERENCES "wg_socks_services"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_socks_clients" DROP CONSTRAINT "FK_957d708aab093910f18bc7e9ac2"`);
        await queryRunner.query(`ALTER TABLE "wg_socks_users" DROP CONSTRAINT "FK_082c838239e2f1ab2f9a6746335"`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" DROP CONSTRAINT "FK_050ae42b7f0a8603b2851b2f541"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_CLIENTS_FP"`);
        await queryRunner.query(`DROP TABLE "wg_socks_clients"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_USERS_NAME"`);
        await queryRunner.query(`DROP TABLE "wg_socks_users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_NAME"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_NODE_PORT"`);
        await queryRunner.query(`DROP TABLE "wg_socks_services"`);
    }

}
