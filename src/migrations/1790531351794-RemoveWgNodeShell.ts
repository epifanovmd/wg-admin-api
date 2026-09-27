import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveWgNodeShell1790531351794 implements MigrationInterface {
    name = 'RemoveWgNodeShell1790531351794'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Веб-консоль удалена: история shell-команд и право на неё.
        await queryRunner.query(`DELETE FROM "wg_node_commands" WHERE "type" = 'shell'`);
        await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = 'wg:node:shell'`);
        await queryRunner.query(`ALTER TYPE "public"."wg_node_commands_type_enum" RENAME TO "wg_node_commands_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_type_enum" AS ENUM('interface-restart', 'agent-logs', 'agent-update')`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ALTER COLUMN "type" TYPE "public"."wg_node_commands_type_enum" USING "type"::"text"::"public"."wg_node_commands_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_type_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_node_commands_type_enum_old" AS ENUM('shell', 'interface-restart', 'agent-logs', 'agent-update')`);
        await queryRunner.query(`ALTER TABLE "wg_node_commands" ALTER COLUMN "type" TYPE "public"."wg_node_commands_type_enum_old" USING "type"::"text"::"public"."wg_node_commands_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."wg_node_commands_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."wg_node_commands_type_enum_old" RENAME TO "wg_node_commands_type_enum"`);
    }

}
