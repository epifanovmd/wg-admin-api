import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWgForward1790500000003 implements MigrationInterface {
    name = 'CreateWgForward1790500000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_forwards_protocol_enum" AS ENUM('udp', 'tcp')`);
        await queryRunner.query(`CREATE TYPE "public"."wg_forwards_path_enum" AS ENUM('direct', 'ipip')`);
        await queryRunner.query(`CREATE TYPE "public"."wg_forwards_route_enum" AS ENUM('auto', 'tunnel', 'direct')`);
        await queryRunner.query(`CREATE TABLE "wg_forwards" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "description" text, "relay_node_id" uuid NOT NULL, "protocol" "public"."wg_forwards_protocol_enum" NOT NULL, "listen_port" integer NOT NULL, "target_node_id" uuid, "target_host" character varying(255), "target_port" integer NOT NULL, "path" "public"."wg_forwards_path_enum" NOT NULL, "route" "public"."wg_forwards_route_enum" NOT NULL DEFAULT 'auto', "enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4705d8a1e307c55e7bd13c892f7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_FORWARDS_RELAY_PORT" ON "wg_forwards"  ("relay_node_id", "protocol", "listen_port") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_FORWARDS_NAME" ON "wg_forwards"  ("name") `);
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD CONSTRAINT "FK_2ca85749f83b9c3420226d3fcc5" FOREIGN KEY ("relay_node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD CONSTRAINT "FK_2a0617e0182c5f28b649c600eac" FOREIGN KEY ("target_node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP CONSTRAINT "FK_2a0617e0182c5f28b649c600eac"`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP CONSTRAINT "FK_2ca85749f83b9c3420226d3fcc5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_FORWARDS_NAME"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_FORWARDS_RELAY_PORT"`);
        await queryRunner.query(`DROP TABLE "wg_forwards"`);
        await queryRunner.query(`DROP TYPE "public"."wg_forwards_route_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_forwards_path_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_forwards_protocol_enum"`);
    }

}
