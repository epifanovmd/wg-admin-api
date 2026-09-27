import { MigrationInterface, QueryRunner } from "typeorm";

export class WgNodeAgentRemoteIp1790500000001 implements MigrationInterface {
    name = 'WgNodeAgentRemoteIp1790500000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "agent_remote_ip" character varying(45)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "agent_remote_ip"`);
    }

}
