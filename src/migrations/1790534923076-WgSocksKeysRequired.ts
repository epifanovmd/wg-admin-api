import { MigrationInterface, QueryRunner } from "typeorm";

export class WgSocksKeysRequired1790534923076 implements MigrationInterface {
    name = 'WgSocksKeysRequired1790534923076'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Импорт прокси удалён: ключи CA и клиентов теперь есть всегда.
        // Записи без ключа (импорт без ключей) — удалить вручную до миграции.
        const [{ count }] = await queryRunner.query(`SELECT (SELECT count(*) FROM "wg_socks_services" WHERE "ca_key_enc" IS NULL) + (SELECT count(*) FROM "wg_socks_clients" WHERE "key_enc" IS NULL) AS "count"`);
        if (Number(count) > 0) {
            throw new Error(`Прокси или клиенты без ключа (${count}): удалите их перед миграцией — импорт больше не поддерживается`);
        }
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ALTER COLUMN "ca_key_enc" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "wg_socks_clients" ALTER COLUMN "key_enc" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "wg_socks_clients" ALTER COLUMN "key_enc" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "wg_socks_services" ALTER COLUMN "ca_key_enc" DROP NOT NULL`);
    }

}
