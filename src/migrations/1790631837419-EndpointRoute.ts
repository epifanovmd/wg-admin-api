import { MigrationInterface, QueryRunner } from "typeorm";

export class EndpointRoute1790631837419 implements MigrationInterface {
    name = 'EndpointRoute1790631837419'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wg_endpoints_route_enum" AS ENUM('auto', 'tunnel', 'direct')`);
        await queryRunner.query(`ALTER TABLE "wg_endpoints" ADD "route" "public"."wg_endpoints_route_enum" NOT NULL DEFAULT 'auto'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_endpoints" DROP COLUMN "route"`);
        await queryRunner.query(`DROP TYPE "public"."wg_endpoints_route_enum"`);
    }

}
