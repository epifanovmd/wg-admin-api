import { MigrationInterface, QueryRunner } from "typeorm";

export class PeerCreatedBy1790759944024 implements MigrationInterface {
    name = 'PeerCreatedBy1790759944024'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_peers" ADD "created_by_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_WG_PEERS_CREATED_BY" ON "wg_peers"  ("created_by_id") `);
        await queryRunner.query(`ALTER TABLE "wg_peers" ADD CONSTRAINT "FK_08026a9697e1852be0ab6343d79" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_peers" DROP CONSTRAINT "FK_08026a9697e1852be0ab6343d79"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_WG_PEERS_CREATED_BY"`);
        await queryRunner.query(`ALTER TABLE "wg_peers" DROP COLUMN "created_by_id"`);
    }

}
