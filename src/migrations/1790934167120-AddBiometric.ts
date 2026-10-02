import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBiometric1790934167120 implements MigrationInterface {
    name = 'AddBiometric1790934167120'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "biometrics" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "device_id" character varying(100) NOT NULL, "public_key" text NOT NULL, "device_name" character varying(100), "challenge" character varying(64), "challenge_expires_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c70c2bb84b5580ee9beff6daed4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_BIOMETRICS_USER_DEVICE" ON "biometrics"  ("user_id", "device_id") `);
        await queryRunner.query(`ALTER TABLE "biometrics" ADD CONSTRAINT "FK_d9ba3c152902f504cb6f1c0481f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "biometrics" DROP CONSTRAINT "FK_d9ba3c152902f504cb6f1c0481f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_BIOMETRICS_USER_DEVICE"`);
        await queryRunner.query(`DROP TABLE "biometrics"`);
    }

}
