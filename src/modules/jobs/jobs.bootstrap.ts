import { inject, multiInject, optional } from "inversify";
import type { JobWithMetadata, PgBoss, Queue } from "pg-boss";

import { config } from "../../config";
import {
  IBootstrap,
  IJobHandler,
  Injectable,
  JOB_HANDLER,
  logger,
} from "../../core";
import { JobRunner } from "./job.runner";
import { JobCancelWatcher } from "./job-cancel.watcher";
import {
  JobHandlerRegistry,
  resolveDefinition,
  TResolvedJobDefinition,
} from "./job-handler.registry";
import { JobLeaseReaper } from "./job-lease.reaper";
import { JobSignals } from "./job-signals";
import { isJobsWorkerRole, PgBossService } from "./pg-boss.service";

const queueOptions = (
  definition: TResolvedJobDefinition,
): Omit<Queue, "name"> => ({
  retryLimit: definition.retryLimit,
  retryDelay: definition.retryDelaySeconds,
  retryBackoff: definition.retryBackoff,
  expireInSeconds: definition.expireInSeconds,
  notify: true,
});

/**
 * Запуск очереди задач, строго по порядку:
 * 1) `start` pg-boss (схема `pgboss`, миграции);
 * 2) очереди всех обработчиков с политикой из `definition`;
 * 3) сигналы задач (LISTEN) — на всех ролях;
 * 4) на ролях `worker`/`all` — слушатель отмен, возврат задач с истёкшей
 *    арендой, `work` Node-очередей и `schedule` для cron.
 * Остановка — graceful: активные задачи дорабатывают до `JOBS_SHUTDOWN_TIMEOUT_MS`.
 */
@Injectable()
export class JobsBootstrap implements IBootstrap {
  readonly critical = true;

  constructor(
    @inject(PgBossService) private readonly _boss: PgBossService,
    @inject(JobHandlerRegistry) private readonly _registry: JobHandlerRegistry,
    @inject(JobRunner) private readonly _runner: JobRunner,
    @inject(JobCancelWatcher) private readonly _watcher: JobCancelWatcher,
    @inject(JobSignals) private readonly _signals: JobSignals,
    @inject(JobLeaseReaper) private readonly _reaper: JobLeaseReaper,
    @multiInject(JOB_HANDLER)
    @optional()
    private readonly _handlers: IJobHandler[] = [],
  ) {}

  async initialize(): Promise<void> {
    this._registry.register(this._handlers);

    const boss = await this._boss.start();
    const definitions = this._registry
      .all()
      .map(handler => resolveDefinition(handler.definition));

    for (const definition of definitions) {
      await this.ensureQueue(boss, definition);
    }

    // Сигналы нужны и API: ожидание `request` и long-poll внешних воркеров.
    await this._signals.start();

    if (!isJobsWorkerRole()) {
      logger.info(
        { queues: definitions.length },
        "[Jobs] Очередь готова (только постановка)",
      );

      return;
    }

    await this._watcher.start();
    await this._reaper.reap();

    for (const handler of this._registry.internal()) {
      const definition = resolveDefinition(handler.definition);

      await boss.work(
        definition.queue,
        {
          localConcurrency: definition.concurrency,
          // NOTIFY будит воркер о новой задаче, но повторы и отложенные задачи
          // NOTIFY не шлют: опрос остаётся частым (по умолчанию при notify — 30 с).
          notifyPollingIntervalSeconds: 2,
          batchSize: 1,
          includeMetadata: true,
          perJobResults: true,
        },
        (jobs: JobWithMetadata<unknown>[]) =>
          Promise.all(
            jobs.map(job => this._runner.run(handler, job, definition.tracked)),
          ),
      );
    }

    await this.syncSchedules(boss, definitions);

    logger.info(
      {
        queues: definitions.map(d => d.queue),
        listening: this._watcher.isListening,
      },
      "[Jobs] Воркер запущен",
    );
  }

  async destroy(): Promise<void> {
    await this._boss.stop(config.jobs.shutdownTimeoutMs);
    await this._watcher.stop();
    await this._signals.stop();
  }

  /** Создать очередь или привести её политику к `definition`. */
  private async ensureQueue(
    boss: PgBoss,
    definition: TResolvedJobDefinition,
  ): Promise<void> {
    const options = queueOptions(definition);

    if (await boss.getQueue(definition.queue)) {
      await boss.updateQueue(definition.queue, options);
    } else {
      await boss.createQueue(definition.queue, options);
    }
  }

  /** Расписания — ровно те, что объявлены `cron` в коде. */
  private async syncSchedules(
    boss: PgBoss,
    definitions: TResolvedJobDefinition[],
  ): Promise<void> {
    const cron = new Map(
      definitions.filter(d => d.cron).map(d => [d.queue, d.cron as string]),
    );

    for (const schedule of await boss.getSchedules()) {
      if (!cron.has(schedule.name)) {
        await boss.unschedule(schedule.name, schedule.key);
      }
    }

    for (const [queue, expression] of cron) {
      await boss.schedule(queue, expression, null, { tz: "UTC" });
    }
  }
}
