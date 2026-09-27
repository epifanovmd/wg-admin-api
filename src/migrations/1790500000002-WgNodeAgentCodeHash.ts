import { MigrationInterface, QueryRunner } from "typeorm";

export class WgNodeAgentCodeHash1790500000002 implements MigrationInterface {
    name = 'WgNodeAgentCodeHash1790500000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_nodes" ADD "agent_code_hash" character varying(64)`);
        await queryRunner.query(`ALTER TYPE "public"."wg_node_commands_type_enum" ADD VALUE 'agent-update'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_type_enum_old" AS ENUM('shell', 'interface-restart', 'agent-logs')`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ALTER COLUMN "type" TYPE "public"."wg_node_commands_type_enum_old" USING "type"::"text"::"public"."wg_node_commands_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."wg_node_commands_type_enum_old" RENAME TO "wg_node_commands_type_enum"`);
        await queryRunner.query(`ALTER TABLE "wg_nodes" DROP COLUMN "agent_code_hash"`);
    }

}
