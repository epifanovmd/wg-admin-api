import { MigrationInterface, QueryRunner } from "typeorm";

export class InterfaceOwnership1790761119419 implements MigrationInterface {
    name = 'InterfaceOwnership1790761119419'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD "owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_INTERFACES_CREATED_BY" ON "wg_interfaces"  ("created_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_INTERFACES_OWNER" ON "wg_interfaces"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD CONSTRAINT "FK_45c99d5adbd8f7c3aa374e8665e" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD CONSTRAINT "FK_8224392b511084795bece2eebde" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP CONSTRAINT "FK_8224392b511084795bece2eebde"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP CONSTRAINT "FK_45c99d5adbd8f7c3aa374e8665e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_INTERFACES_OWNER"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_INTERFACES_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP COLUMN "owner_id"`);
    }

}
