import { MigrationInterface, QueryRunner } from "typeorm";

export class JobWorkers1790363180288 implements MigrationInterface {
    name = 'JobWorkers1790363180288'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "job_workers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(200) NOT NULL, "queue" character varying(100) NOT NULL, "key_id" character varying(100), "meta" jsonb NOT NULL DEFAULT '{}', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_25a2b482332defbe350938ba653" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_JOB_WORKERS_QUEUE_SEEN" ON "job_workers"  ("queue", "last_seen_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_JOB_WORKERS_NAME_QUEUE" ON "job_workers"  ("name", "queue") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_JOB_WORKERS_NAME_QUEUE"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_JOB_WORKERS_QUEUE_SEEN"`);
        await queryRunner.query(`DROP TABLE "job_workers"`);
    }

}
