import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Права `*:manage` заменены правами на отдельные действия. Кто имел `manage`
 * (роль, прямое право, scope API-ключа), получает все действия сущности —
 * доступ не меняется. Произвольные хуки интерфейса раньше были только у
 * суперпользователя, поэтому `wg:interface:hooks` не выдаётся.
 */
const SPLIT: Record<string, string[]> = {
  "apikey:manage": ["apikey:view", "apikey:create", "apikey:revoke"],
  "role:manage": ["role:create", "role:update", "role:delete"],
  "user:manage": ["user:update", "user:delete", "user:privileges"],
  "profile:manage": ["profile:update", "profile:delete"],
  "wg:node:manage": [
    "wg:node:create",
    "wg:node:update",
    "wg:node:delete",
    "wg:node:agent",
    "wg:node:logs",
  ],
  "wg:interface:manage": [
    "wg:interface:create",
    "wg:interface:update",
    "wg:interface:delete",
    "wg:interface:control",
    "wg:interface:move",
    "wg:interface:replicas",
  ],
  "wg:peer:manage": [
    "wg:peer:create",
    "wg:peer:update",
    "wg:peer:delete",
    "wg:peer:toggle",
    "wg:peer:psk",
    "wg:peer:assign",
  ],
  "wg:endpoint:manage": [
    "wg:endpoint:create",
    "wg:endpoint:update",
    "wg:endpoint:delete",
  ],
  "wg:forward:manage": [
    "wg:forward:create",
    "wg:forward:update",
    "wg:forward:delete",
  ],
  "wg:socks:manage": [
    "wg:socks:create",
    "wg:socks:update",
    "wg:socks:delete",
    "wg:socks:users",
    "wg:socks:secrets",
    "wg:socks:clients",
  ],
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

/** Обратно: у кого есть все действия сущности, снова получает `manage`. */
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

export class SplitManagePermissions1790600000000 implements MigrationInterface {
  name = "SplitManagePermissions1790600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of Object.entries(SPLIT)) {
      await expand(queryRunner, from, to);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [to, from] of Object.entries(SPLIT)) {
      await collapse(queryRunner, to, from);
    }
  }
}
