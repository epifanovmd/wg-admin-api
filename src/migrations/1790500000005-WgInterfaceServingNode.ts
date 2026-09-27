import { MigrationInterface, QueryRunner } from "typeorm";

export class WgInterfaceServingNode1790500000005 implements MigrationInterface {
    name = 'WgInterfaceServingNode1790500000005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_interfaces" ADD "serving_node_id" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_interfaces" DROP COLUMN "serving_node_id"`);
    }

}
