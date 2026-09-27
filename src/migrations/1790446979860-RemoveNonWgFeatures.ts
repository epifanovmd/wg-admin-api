import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Удаление функций шаблона, не нужных админке WireGuard: файлы и аватары,
 * биометрия, настройки приватности и presence, внешние воркеры задач.
 * Таблицы удалённых сущностей TypeORM не отслеживает — удаляются явно;
 * CASCADE снимает внешние ключи таблиц других веток шаблона, если они есть.
 */
export class RemoveNonWgFeatures1790446979860 implements MigrationInterface {
    name = 'RemoveNonWgFeatures1790446979860'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profiles" DROP CONSTRAINT "FK_768e6771e0ced8d2993a088b2f3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_PROFILES_LAST_ONLINE"`);
        await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "last_online"`);
        await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "avatar_id"`);
        await queryRunner.query(`DROP TABLE "files" CASCADE`);
        await queryRunner.query(`DROP TYPE "public"."files_status_enum"`);
        await queryRunner.query(`DROP TABLE "privacy_settings"`);
        await queryRunner.query(`DROP TYPE "public"."privacy_settings_show_avatar_enum"`);
        await queryRunner.query(`DROP TYPE "public"."privacy_settings_show_phone_enum"`);
        await queryRunner.query(`DROP TYPE "public"."privacy_settings_show_last_online_enum"`);
        await queryRunner.query(`DROP TABLE "biometrics"`);
        await queryRunner.query(`DROP TABLE "job_workers"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "job_workers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(200) NOT NULL, "queue" character varying(100) NOT NULL, "key_id" character varying(100), "meta" jsonb NOT NULL DEFAULT '{}', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_25a2b482332defbe350938ba653" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_JOB_WORKERS_QUEUE_SEEN" ON "job_workers"  ("queue", "last_seen_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_JOB_WORKERS_NAME_QUEUE" ON "job_workers"  ("name", "queue") `);
        await queryRunner.query(`CREATE TABLE "biometrics" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "device_id" character varying(100) NOT NULL, "public_key" text NOT NULL, "device_name" character varying(100), "challenge" character varying(64), "challenge_expires_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c70c2bb84b5580ee9beff6daed4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_BIOMETRICS_USER_DEVICE" ON "biometrics"  ("user_id", "device_id") `);
        await queryRunner.query(`ALTER TABLE "biometrics" ADD CONSTRAINT "FK_d9ba3c152902f504cb6f1c0481f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TYPE "public"."privacy_settings_show_last_online_enum" AS ENUM('everyone', 'contacts', 'nobody')`);
        await queryRunner.query(`CREATE TYPE "public"."privacy_settings_show_phone_enum" AS ENUM('everyone', 'contacts', 'nobody')`);
        await queryRunner.query(`CREATE TYPE "public"."privacy_settings_show_avatar_enum" AS ENUM('everyone', 'contacts', 'nobody')`);
        await queryRunner.query(`CREATE TABLE "privacy_settings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "show_last_online" "public"."privacy_settings_show_last_online_enum" NOT NULL DEFAULT 'everyone', "show_phone" "public"."privacy_settings_show_phone_enum" NOT NULL DEFAULT 'contacts', "show_avatar" "public"."privacy_settings_show_avatar_enum" NOT NULL DEFAULT 'everyone', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_626e170465665a6a6e9831bb153" UNIQUE ("user_id"), CONSTRAINT "REL_626e170465665a6a6e9831bb15" UNIQUE ("user_id"), CONSTRAINT "PK_e31cc479f8c3267c86511223ea0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_PRIVACY_USER" ON "privacy_settings"  ("user_id") `);
        await queryRunner.query(`ALTER TABLE "privacy_settings" ADD CONSTRAINT "FK_626e170465665a6a6e9831bb153" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TYPE "public"."files_status_enum" AS ENUM('pending', 'processing', 'ready', 'failed')`);
        await queryRunner.query(`CREATE TABLE "files" ("id" uuid NOT NULL, "owner_id" uuid, "name" character varying(255) NOT NULL, "type" character varying(127) NOT NULL, "size" bigint NOT NULL, "status" "public"."files_status_enum" NOT NULL DEFAULT 'ready', "key" character varying(1024) NOT NULL, "optimized_key" character varying(1024), "thumbnail_key" character varying(1024), "medium_key" character varying(1024), "width" integer, "height" integer, "blurhash" character varying(100), "duration" double precision, "waveform" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_FILES_STATUS_CREATED" ON "files"  ("status", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_FILES_OWNER" ON "files"  ("owner_id") `);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "profiles" ADD "avatar_id" uuid`);
        await queryRunner.query(`ALTER TABLE "profiles" ADD "last_online" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_PROFILES_LAST_ONLINE" ON "profiles" USING btree ("last_online") `);
        await queryRunner.query(`ALTER TABLE "profiles" ADD CONSTRAINT "FK_768e6771e0ced8d2993a088b2f3" FOREIGN KEY ("avatar_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
