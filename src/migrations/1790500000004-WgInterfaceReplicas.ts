import { MigrationInterface, QueryRunner } from "typeorm";

export class WgInterfaceReplicas1790500000004 implements MigrationInterface {
    name = 'WgInterfaceReplicas1790500000004'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_interface_replicas_status_enum" AS ENUM('up', 'down', 'error', 'unknown')`);
        await queryRunner.query(`CREATE TABLE "wg_interface_replicas" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "interface_id" uuid NOT NULL, "node_id" uuid NOT NULL, "priority" integer NOT NULL, "status" "public"."wg_interface_replicas_status_enum" NOT NULL DEFAULT 'unknown', "status_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_76978eb58b5e03907df8415ca00" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_WG_IFACE_REPLICAS_PAIR" ON "wg_interface_replicas"  ("interface_id", "node_id") `);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD "active_replica_node_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_interface_replicas" ADD CONSTRAINT "FK_25aac3a7044881171e6955e5848" FOREIGN KEY ("interface_id") REFERENCES "wg_interfaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_interface_replicas" ADD CONSTRAINT "FK_cbbcea8762cfdad4787250f9612" FOREIGN KEY ("node_id") REFERENCES "wg_nodes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_interface_replicas" DROP CONSTRAINT "FK_cbbcea8762cfdad4787250f9612"`);
        await queryRunner.query(`ALTER TABLE "wg_interface_replicas" DROP CONSTRAINT "FK_25aac3a7044881171e6955e5848"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP COLUMN "active_replica_node_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_IFACE_REPLICAS_PAIR"`);
        await queryRunner.query(`DROP TABLE "wg_interface_replicas"`);
        await queryRunner.query(`DROP TYPE "public"."wg_interface_replicas_status_enum"`);
    }

}
