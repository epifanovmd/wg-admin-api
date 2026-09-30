import { MigrationInterface, QueryRunner } from "typeorm";

export class ForwardOwnership1790761799602 implements MigrationInterface {
    name = 'ForwardOwnership1790761799602'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD "owner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_FORWARDS_CREATED_BY" ON "wg_forwards"  ("created_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_WG_FORWARDS_OWNER" ON "wg_forwards"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD CONSTRAINT "FK_0b16e818e5f5778b27d55e077ab" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" ADD CONSTRAINT "FK_800df8b3b71a30e1966e782ebbb" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP CONSTRAINT "FK_800df8b3b71a30e1966e782ebbb"`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP CONSTRAINT "FK_0b16e818e5f5778b27d55e077ab"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_FORWARDS_OWNER"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_FORWARDS_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP COLUMN "created_by_id"`);
        await queryRunner.query(`ALTER TABLE "wg_forwards" DROP COLUMN "owner_id"`);
    }

}
