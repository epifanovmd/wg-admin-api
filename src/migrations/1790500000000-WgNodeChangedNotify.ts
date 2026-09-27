import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * NOTIFY `wg_node_changed` (payload — id ноды) при смене версии конфигурации
 * ноды и появлении команды: будит long-poll агента сразу после коммита.
 * Триггеры не описываются сущностями — создаются явно.
 */
export class WgNodeChangedNotify1790500000000 implements MigrationInterface {
    name = 'WgNodeChangedNotify1790500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION wg_notify_node_changed() RETURNS trigger AS $$
            BEGIN
                PERFORM pg_notify('wg_node_changed', to_jsonb(NEW) ->> TG_ARGV[0]);
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql
        `);
        await queryRunner.query(`
            CREATE TRIGGER wg_nodes_config_version_notify
            AFTER UPDATE OF config_version ON wg_nodes
            FOR EACH ROW
            WHEN (OLD.config_version IS DISTINCT FROM NEW.config_version)
            EXECUTE FUNCTION wg_notify_node_changed('id')
        `);
        await queryRunner.query(`
            CREATE TRIGGER wg_node_commands_insert_notify
            AFTER INSERT ON wg_node_commands
            FOR EACH ROW
            EXECUTE FUNCTION wg_notify_node_changed('node_id')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS wg_node_commands_insert_notify ON wg_node_commands`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS wg_nodes_config_version_notify ON wg_nodes`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS wg_notify_node_changed()`);
    }
}
