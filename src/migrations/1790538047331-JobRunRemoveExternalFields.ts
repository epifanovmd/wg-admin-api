import { MigrationInterface, QueryRunner } from "typeorm";

export class JobRunRemoveExternalFields1790538047331 implements MigrationInterface {
    name = 'JobRunRemoveExternalFields1790538047331'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_runs" DROP COLUMN "files"`);
        await queryRunner.query(`ALTER TABLE "job_runs" DROP COLUMN "stop_requested"`);
        // Право больше не объявляется модулем задач.
        await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = 'jobs:manage'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_runs" ADD "stop_requested" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "job_runs" ADD "files" jsonb`);
    }

}
