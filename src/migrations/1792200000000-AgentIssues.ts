import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Одноразовые ссылки на архив агента с токеном: параметры токена, срок ссылки, когда скачан и
 * какой токен создан при скачивании.
 */
export class AgentIssues1792200000000 implements MigrationInterface {
  name = "AgentIssues1792200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_issues" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "params" jsonb NOT NULL,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "downloaded_at" timestamptz,
        "token_id" uuid
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "agent_issues"`);
  }
}
