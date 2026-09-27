import { DataSource } from "typeorm";

import { config, nodeEnv } from "../../config";
import { EntityClass } from "../decorators";

export interface CreateDataSourceOptions {
  /** Сущности из реестра модулей (`collectEntities(AppModule)`). */
  entities: EntityClass[];
  /** Классы миграций в порядке применения (`src/migrations/index.ts`). */
  migrations: Function[];
}

/**
 * Схема БД живёт только в миграциях: `synchronize` выключен во всех
 * окружениях, миграции применяет `runMigrations` под advisory-lock, поэтому
 * несколько реплик могут стартовать одновременно.
 */
export const createDataSource = ({
  entities,
  migrations,
}: CreateDataSourceOptions): DataSource => {
  const {
    host,
    port,
    database,
    username,
    password,
    ssl,
    sslCa,
    sslRejectUnauthorized,
    poolMax,
    connectionTimeoutMs,
    statementTimeoutMs,
    slowQueryMs,
  } = config.database.postgres;

  return new DataSource({
    type: "postgres",
    host,
    port,
    database,
    username,
    password,
    entities,
    migrations,
    migrationsTableName: "migrations",
    // uuid по умолчанию — встроенный gen_random_uuid() (Postgres 13+):
    // расширения не нужны, работает на управляемых БД без прав суперпользователя.
    uuidExtension: "pgcrypto",
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    applicationName: `${config.app.name}:${nodeEnv}`,
    maxQueryExecutionTime: slowQueryMs,
    ssl: ssl
      ? { ca: sslCa || undefined, rejectUnauthorized: sslRejectUnauthorized }
      : false,
    extra: {
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: connectionTimeoutMs,
      statement_timeout: statementTimeoutMs,
    },
  });
};
