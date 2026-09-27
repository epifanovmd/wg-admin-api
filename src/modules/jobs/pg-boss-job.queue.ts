import { inject } from "inversify";
import type { SendOptions } from "pg-boss";
import { DataSource, EntityManager } from "typeorm";

import {
  EnqueueOptions,
  Injectable,
  JobQueue,
  logger,
  RequestOptions,
} from "../../core";
import { JobCancelWatcher } from "./job-cancel.watcher";
import { JobHandlerRegistry } from "./job-handler.registry";
import { JobResultWaiter } from "./job-result.waiter";
import { JobRun } from "./job-run.entity";
import { JobRunTracker } from "./job-run.tracker";
import { JobsError } from "./jobs.errors";
import {
  ACTIVE_JOB_RUN_STATUSES,
  EJobRunStatus,
  JOB_REQUEST_TIMEOUT_MS,
} from "./jobs.types";
import { managerDb, PgBossService } from "./pg-boss.service";

/**
 * `JobQueue` на pg-boss. Видимая задача ставится вместе с записью
 * `job_runs` в одной транзакции: переданной (`manager`, outbox) или своей.
 */
@Injectable()
export class PgBossJobQueue extends JobQueue {
  constructor(
    @inject(PgBossService) private readonly _boss: PgBossService,
    @inject(JobHandlerRegistry) private readonly _registry: JobHandlerRegistry,
    @inject(JobRunTracker) private readonly _tracker: JobRunTracker,
    @inject(JobCancelWatcher) private readonly _watcher: JobCancelWatcher,
    @inject(JobResultWaiter) private readonly _waiter: JobResultWaiter,
    @inject(DataSource) private readonly _dataSource: DataSource,
  ) {
    super();
  }

  async enqueue<T extends object>(
    queue: string,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    // Реестр заполняется до старта pg-boss: после ready() он полон.
    const boss = await this._boss.ready();
    const definition = this._registry.definition(queue);

    if (!definition) throw JobsError.UNKNOWN_QUEUE({ queue });

    const sendOptions: SendOptions = {
      ...(options.startAfter !== undefined && {
        startAfter: options.startAfter,
      }),
      ...(options.singletonKey !== undefined && {
        singletonKey: options.singletonKey,
      }),
      ...(options.priority !== undefined && { priority: options.priority }),
    };

    if (!definition.tracked && !options.track) {
      return boss.send(queue, data, {
        ...sendOptions,
        ...(options.manager && { db: managerDb(options.manager) }),
      });
    }

    const enqueueTracked = async (
      manager: EntityManager,
    ): Promise<JobRun | null> => {
      const id = await boss.send(queue, data, {
        ...sendOptions,
        db: managerDb(manager),
      });

      if (!id) return null;

      const run = await this._tracker.create(manager, {
        id,
        queue,
        title: options.title,
        ownerId: options.ownerId,
        scope: options.scope,
      });

      return run;
    };

    // С чужой транзакцией момент коммита неизвестен: событие «в очереди» не
    // публикуется, клиент увидит задачу по ответу API и событию старта.
    if (options.manager) {
      return (await enqueueTracked(options.manager))?.id ?? null;
    }

    const run = await this._dataSource.transaction(enqueueTracked);

    if (run) this._tracker.publish(run);

    return run?.id ?? null;
  }

  async request<T extends object, R = unknown>(
    queue: string,
    data: T,
    options: RequestOptions = {},
  ): Promise<R> {
    const { timeoutMs = JOB_REQUEST_TIMEOUT_MS, ...enqueueOptions } = options;
    const id = await this.enqueue(queue, data, {
      ...enqueueOptions,
      track: true,
    });

    if (!id) throw JobsError.NOT_FOUND();

    const run = await this._waiter.wait(id, timeoutMs);

    if (!run) {
      await this.cancel(id).catch(err =>
        logger.warn({ err, jobId: id }, "[Jobs] Не удалось снять запрос"),
      );
      throw JobsError.REQUEST_TIMEOUT({ queue, timeoutMs });
    }

    if (run.status === EJobRunStatus.COMPLETED) return run.result as R;

    throw JobsError.REQUEST_FAILED({
      queue,
      status: run.status,
      ...(run.error && { code: run.error.code, reason: run.error.message }),
    });
  }

  async cancel(jobId: string): Promise<void> {
    const run = await this._tracker.find(jobId);
    const queue = run?.queue ?? (await this._boss.findJob(jobId))?.queue;

    if (!queue) throw JobsError.NOT_FOUND();
    if (run && !ACTIVE_JOB_RUN_STATUSES.includes(run.status)) return;

    if (run) {
      // Ждущую задачу отменяем сразу; выполняющуюся Node-воркер завершит
      // сам, получив сигнал.
      if (run.status === EJobRunStatus.QUEUED)
        await this._tracker.cancelled(run);
      else await this._tracker.update(run, { cancelRequested: true });
    }

    const boss = await this._boss.ready();

    await boss.cancel(queue, jobId);
    await this._watcher
      .notify(jobId)
      .catch(err =>
        logger.warn({ err, jobId }, "[Jobs] NOTIFY об отмене не отправлен"),
      );
  }
}
