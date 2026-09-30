import { MigrationInterface, QueryRunner } from "typeorm";

export class SocksOwnership1790762066727 implements MigrationInterface {
    name = 'SocksOwnership1790762066727'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ADD "owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_SOCKS_CREATED_BY" ON "wg_socks_services"  ("created_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_SOCKS_OWNER" ON "wg_socks_services"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ADD CONSTRAINT "FK_74d08b2d14cb73e89ee21de9964" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ADD CONSTRAINT "FK_1e276cc964ec7a71b7e9ceb17e0" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_socks_services" DROP CONSTRAINT "FK_1e276cc964ec7a71b7e9ceb17e0"`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" DROP CONSTRAINT "FK_74d08b2d14cb73e89ee21de9964"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_OWNER"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_SOCKS_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" DROP COLUMN "owner_id"`);
    }

}
