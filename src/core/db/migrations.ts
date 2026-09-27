import { DataSource } from "typeorm";

/**
 * Ключ `pg_advisory_lock` на время применения миграций: реплики, стартующие
 * одновременно, выстраиваются в очередь, и каждая видит уже применённое.
 */
export const MIGRATIONS_LOCK_KEY = 7_268_650_001;

/** Применить ожидающие миграции; возвращает имена применённых. */
export const runMigrations = async (
  dataSource: DataSource,
): Promise<string[]> => {
  const runner = dataSource.createQueryRunner();

  await runner.connect();

  try {
    await runner.query("SELECT pg_advisory_lock($1)", [MIGRATIONS_LOCK_KEY]);

    try {
      const applied = await dataSource.runMigrations({ transaction: "each" });

      return applied.map(migration => migration.name);
    } finally {
      await runner.query("SELECT pg_advisory_unlock($1)", [
        MIGRATIONS_LOCK_KEY,
      ]);
    }
  } finally {
    await runner.release();
  }
};

/** Есть ли миграции, которых нет в БД (для readiness и диагностики). */
export const hasPendingMigrations = (
  dataSource: DataSource,
): Promise<boolean> => dataSource.showMigrations();
