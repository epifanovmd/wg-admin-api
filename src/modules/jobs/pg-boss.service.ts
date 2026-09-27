import type { ConstructorOptions, Db } from "pg-boss";
import { PgBoss } from "pg-boss";
import type { EntityManager } from "typeorm";

import { config, nodeEnv } from "../../config";
import { Injectable, logger, ServiceUnavailableException } from "../../core";
import { PGBOSS_SCHEMA } from "./jobs.types";

export type TPgBossJobState =
  "created" | "retry" | "active" | "completed" | "cancelled" | "failed";

export interface IPgBossJobRef {
  queue: string;
  state: TPgBossJobState;
  retryCount: number;
  retryLimit: number;
}

/** Процесс выполняет задачи и cron: роли `worker` и `all`. */
export const isJobsWorkerRole = (): boolean => config.app.role !== "api";

/** Параметры pg-boss: своя схема и пул, cron и обслуживание — только у воркеров. */
export const pgBossOptions = (): ConstructorOptions => {
  const pg = config.database.postgres;
  const worker = isJobsWorkerRole();

  return {
    host: pg.host,
    port: pg.port,
    database: pg.database,
    user: pg.username,
    password: pg.password,
    ssl: pg.ssl
      ? {
          ca: pg.sslCa || undefined,
          rejectUnauthorized: pg.sslRejectUnauthorized,
        }
      : false,
    max: config.jobs.poolMax,
    connectionTimeoutMillis: pg.connectionTimeoutMs,
    application_name: `${config.app.name}:${nodeEnv}:jobs`,
    schema: PGBOSS_SCHEMA,
    migrate: true,
    schedule: worker,
    supervise: worker,
    // Воркер просыпается по NOTIFY о новой задаче; опрос остаётся запасным.
    useListenNotify: worker,
  };
};

/**
 * `db` для pg-boss поверх транзакции TypeORM: задача создаётся в той же
 * транзакции, что и изменения данных (outbox).
 */
export const managerDb = (manager: EntityManager): Db => ({
  executeSql: async (text, values) => {
    const runner = manager.queryRunner;

    if (runner) {
      const result = await runner.query(text, values as unknown[], true);

      return { rows: result.records ?? [] };
    }

    const rows: unknown = await manager.query(text, values as unknown[]);

    return { rows: Array.isArray(rows) ? rows : [] };
  },
});

/**
 * Экземпляр pg-boss процесса. До `start()` вызовы ждут готовности:
 * `enqueue` из раннего бутстрапера не теряется.
 */
@Injectable()
export class PgBossService {
  private _boss: PgBoss | null = null;
  private _resolveReady!: (boss: PgBoss) => void;
  private _rejectReady!: (err: unknown) => void;
  private _ready = this.createReady();
  private _stopped = false;

  /** Создаёт экземпляр; фабрика подменяется в тестах. */
  protected createBoss(options: ConstructorOptions): PgBoss {
    return new PgBoss(options);
  }

  get isStarted(): boolean {
    return this._boss !== null;
  }

  async start(): Promise<PgBoss> {
    if (this._boss) return this._boss;

    const boss = this.createBoss(pgBossOptions());

    boss.on("error", err => logger.error({ err }, "[Jobs] pg-boss error"));
    boss.on("warning", warning =>
      logger.warn({ warning }, "[Jobs] pg-boss warning"),
    );

    try {
      await boss.start();
    } catch (err) {
      this._rejectReady(err);
      this._ready = this.createReady();
      throw err;
    }

    this._boss = boss;
    this._resolveReady(boss);

    return boss;
  }

  /** Экземпляр после старта; после остановки — 503. */
  ready(): Promise<PgBoss> {
    if (this._stopped) {
      return Promise.reject(
        new ServiceUnavailableException("Очередь задач остановлена"),
      );
    }

    return this._boss ? Promise.resolve(this._boss) : this._ready;
  }

  async stop(timeoutMs: number): Promise<void> {
    this._stopped = true;
    if (!this._boss) return;

    await this._boss.stop({ graceful: true, timeout: timeoutMs });
    this._boss = null;
  }

  /** Очередь и состояние задачи по id; `null` — задачи нет (или удалена). */
  async findJob(id: string): Promise<IPgBossJobRef | null> {
    const boss = await this.ready();
    const { rows } = await boss
      .getDb()
      .executeSql(
        `SELECT name, state, retry_count, retry_limit FROM ${PGBOSS_SCHEMA}.job WHERE id = $1 LIMIT 1`,
        [id],
      );
    const row = rows[0] as
      | {
          name: string;
          state: TPgBossJobState;
          retry_count: number;
          retry_limit: number;
        }
      | undefined;

    return row
      ? {
          queue: row.name,
          state: row.state,
          retryCount: row.retry_count,
          retryLimit: row.retry_limit,
        }
      : null;
  }

  /** Из `ids` — задачи, отменённые в pg-boss. */
  async findCancelledIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];

    const boss = await this.ready();
    const { rows } = await boss
      .getDb()
      .executeSql(
        `SELECT id FROM ${PGBOSS_SCHEMA}.job WHERE id = ANY($1::uuid[]) AND state = 'cancelled'`,
        [ids],
      );

    return rows.map(row => String((row as { id: string }).id));
  }

  /**
   * Провалить активную задачу без повторов. У pg-boss нет `fail` без
   * повторов вне `work`: исчерпываем лимит повторов задачи и падаем.
   */
  async failFinal(queue: string, id: string, output: object): Promise<void> {
    const boss = await this.ready();

    await boss
      .getDb()
      .executeSql(
        `UPDATE ${PGBOSS_SCHEMA}.job SET retry_limit = retry_count WHERE name = $1 AND id = $2 AND state = 'active'`,
        [queue, id],
      );
    await boss.fail(queue, id, output);
  }

  private createReady(): Promise<PgBoss> {
    const ready = new Promise<PgBoss>((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    // Отказ старта наблюдает бутстрапер; здесь — без unhandled rejection.
    ready.catch(() => undefined);

    return ready;
  }
}
