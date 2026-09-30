import { MigrationInterface, QueryRunner } from "typeorm";

export class EndpointOwnership1790761514632 implements MigrationInterface {
    name = 'EndpointOwnership1790761514632'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD "owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_ENDPOINTS_CREATED_BY" ON "wg_endpoints"  ("created_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_ENDPOINTS_OWNER" ON "wg_endpoints"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD CONSTRAINT "FK_fd1879b7f3b5cd907fbaf98ef98" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD CONSTRAINT "FK_d11a4b26b4aecec15ae1fea9a0d" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP CONSTRAINT "FK_d11a4b26b4aecec15ae1fea9a0d"`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP CONSTRAINT "FK_fd1879b7f3b5cd907fbaf98ef98"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_ENDPOINTS_OWNER"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_ENDPOINTS_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP COLUMN "owner_id"`);
    }

}
