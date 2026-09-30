import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Права «на свои» пиры стали областью действий: `wg:peer:own` → просмотр
 * (с конфигом и QR) и включение своих пиров, `wg:stats:own` → просмотр
 * статистики своих пиров. Кто имел старое право (роль, прямое право, scope
 * API-ключа), получает новые — доступ не меняется.
 */
const RENAME: Record<string, string[]> = {
  "wg:peer:own": ["wg:peer:view:own", "wg:peer:toggle:own"],
  "wg:stats:own": ["wg:stats:view:own"],
};

const expand = async (
  queryRunner: QueryRunner,
  from: string,
  to: string[],
): Promise<void> => {
  await queryRunner.query(
    `INSERT INTO "permissions" ("name") SELECT unnest($1::varchar[]) ON CONFLICT ("name") DO NOTHING`,
    [to],
  );

  for (const table of ["role_permissions", "user_permissions"]) {
    const owner = table === "role_permissions" ? "role_id" : "user_id";

    await queryRunner.query(
      `INSERT INTO "${table}" ("${owner}", "permission_id")
       SELECT link."${owner}", target."id"
       FROM "${table}" link
       JOIN "permissions" source ON source."id" = link."permission_id" AND source."name" = $1
       JOIN "permissions" target ON target."name" = ANY($2::varchar[])
       ON CONFLICT DO NOTHING`,
      [from, to],
    );
  }

  await queryRunner.query(
    `UPDATE "api_keys"
     SET "scopes" = ARRAY(SELECT DISTINCT unnest(array_remove("scopes", $1) || $2::varchar[]))
     WHERE $1 = ANY("scopes")`,
    [from, to],
  );
  await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [
    from,
  ]);
};

/** Обратно: у кого есть все новые права, снова получает прежнее. */
const collapse = async (
  queryRunner: QueryRunner,
  to: string,
  from: string[],
): Promise<void> => {
  await queryRunner.query(
    `INSERT INTO "permissions" ("name") VALUES ($1) ON CONFLICT ("name") DO NOTHING`,
    [to],
  );

  for (const table of ["role_permissions", "user_permissions"]) {
    const owner = table === "role_permissions" ? "role_id" : "user_id";

    await queryRunner.query(
      `INSERT INTO "${table}" ("${owner}", "permission_id")
       SELECT link."${owner}", (SELECT "id" FROM "permissions" WHERE "name" = $1)
       FROM "${table}" link
       JOIN "permissions" source ON source."id" = link."permission_id"
       WHERE source."name" = ANY($2::varchar[])
       GROUP BY link."${owner}"
       HAVING COUNT(DISTINCT source."name") = cardinality($2::varchar[])
       ON CONFLICT DO NOTHING`,
      [to, from],
    );
  }

  await queryRunner.query(
    `UPDATE "api_keys"
     SET "scopes" = ARRAY(SELECT DISTINCT unnest(ARRAY(SELECT s FROM unnest("scopes") s WHERE s <> ALL($2::varchar[])) || ARRAY[$1]::varchar[]))
     WHERE "scopes" @> $2::varchar[]`,
    [to, from],
  );
  await queryRunner.query(
    `DELETE FROM "permissions" WHERE "name" = ANY($1::varchar[])`,
    [from],
  );
};

export class ScopedPeerPermissions1790759944025 implements MigrationInterface {
  name = "ScopedPeerPermissions1790759944025";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of Object.entries(RENAME)) {
      await expand(queryRunner, from, to);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [to, from] of Object.entries(RENAME)) {
      await collapse(queryRunner, to, from);
    }
  }
}
