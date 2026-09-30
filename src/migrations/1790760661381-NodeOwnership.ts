import { MigrationInterface, QueryRunner } from "typeorm";

export class NodeOwnership1790760661381 implements MigrationInterface {
    name = 'NodeOwnership1790760661381'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODES_CREATED_BY" ON "wg_nodes"  ("created_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_NODES_OWNER" ON "wg_nodes"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD CONSTRAINT "FK_6315419a6751ea0630417947b7f" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD CONSTRAINT "FK_11d1a570e16583ca4a560a65046" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP CONSTRAINT "FK_11d1a570e16583ca4a560a65046"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP CONSTRAINT "FK_6315419a6751ea0630417947b7f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODES_OWNER"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_NODES_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "owner_id"`);
    }

}
