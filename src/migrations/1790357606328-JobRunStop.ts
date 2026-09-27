import { MigrationInterface, QueryRunner } from "typeorm";

export class JobRunStop1790357606328 implements MigrationInterface {
    name = 'JobRunStop1790357606328'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_runs" ADD "stop_requested" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_runs" DROP COLUMN "stop_requested"`);
    }

}
