import { inject } from "inversify";
import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { EventBus, Injectable, type JobScope } from "../../core";
import { JobRunDto } from "./dto/job-run.dto";
import { JobUpdatedEvent } from "./events";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobSignals } from "./job-signals";
import {
  EJobRunStatus,
  IJobRunError,
  JOB_LOG_LINE_MAX,
  JOB_LOG_TAIL_SIZE,
  JOB_SETTLED_CHANNEL,
  SETTLED_JOB_RUN_STATUSES,
} from "./jobs.types";

export interface ICreateJobRun {
  id: string;
  queue: string;
  title?: string;
  ownerId?: string;
  scope?: JobScope;
}

export interface IStartJobRun {
  id: string;
  queue: string;
  attempt: number;
  leaseSeconds: number;
  /** Записи нет (задача из cron) — создать её. */
  createIfMissing: boolean;
}

type TJobRunPatch = Partial<
  Pick<
    JobRun,
    | "status"
    | "progress"
    | "progressText"
    | "logTail"
    | "result"
    | "error"
    | "attempt"
    | "cancelRequested"
    | "leaseUntil"
    | "startedAt"
    | "finishedAt"
  >
>;

const TITLE_MAX = 200;
const PROGRESS_TEXT_MAX = 200;

export const secondsFromNow = (seconds: number): Date =>
  new Date(Date.now() + seconds * 1000);

/** Дописать строки в хвост лога: с отметкой времени, не длиннее лимитов. */
export const appendLogTail = (tail: string[], lines: string[]): string[] => {
  const stamp = new Date().toISOString().slice(11, 19);
  const stamped = lines.map(
    line => `${stamp} ${line.slice(0, JOB_LOG_LINE_MAX)}`,
  );

  return [...tail, ...stamped].slice(-JOB_LOG_TAIL_SIZE);
};

export const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * Состояние видимых задач: создание, переходы статусов, прогресс. Пишет
 * точечными `UPDATE` и публикует `JobUpdatedEvent` после записи.
 */
@Injectable()
export class JobRunTracker {
  constructor(
    @inject(JobRunRepository) private readonly _repo: JobRunRepository,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(JobSignals) private readonly _signals: JobSignals,
  ) {}

  /** Запись о задаче в транзакции постановки (outbox); событие — после коммита. */
  async create(manager: EntityManager, data: ICreateJobRun): Promise<JobRun> {
    const repo = manager.getRepository(JobRun);

    return repo.save(
      repo.create({
        id: data.id,
        queue: data.queue,
        status: EJobRunStatus.QUEUED,
        title: (data.title ?? data.queue).slice(0, TITLE_MAX),
        progress: 0,
        progressText: null,
        logTail: [],
        result: null,
        error: null,
        ownerId: data.ownerId ?? null,
        scopeType: data.scope?.type ?? null,
        scopeId: data.scope?.id ?? null,
        attempt: 0,
        cancelRequested: false,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
      }),
    );
  }

  find(id: string): Promise<JobRun | null> {
    return this._repo.findById(id);
  }

  publish(run: JobRun): void {
    this._eventBus.emit(new JobUpdatedEvent(JobRunDto.fromEntity(run)));
  }

  /**
   * Задача взята воркером. `null` — задача невидимая. Завершённую или
   * отменённую запись возвращает как есть: выполнять её не нужно.
   */
  async start(params: IStartJobRun): Promise<JobRun | null> {
    const startedAt = new Date();
    const patch = {
      attempt: params.attempt,
      startedAt,
      leaseUntil: secondsFromNow(params.leaseSeconds),
    };

    if (await this._repo.markRunning(params.id, patch)) {
      const run = await this._repo.findById(params.id);

      if (run) this.publish(run);

      return run;
    }

    const existing = await this._repo.findById(params.id);

    if (existing || !params.createIfMissing) return existing;

    const run = await this._repo.save(
      this._repo.create({
        id: params.id,
        queue: params.queue,
        status: EJobRunStatus.RUNNING,
        title: params.queue,
        progress: 0,
        progressText: null,
        logTail: [],
        result: null,
        error: null,
        ownerId: null,
        scopeType: null,
        scopeId: null,
        cancelRequested: false,
        finishedAt: null,
        ...patch,
      }),
    );

    this.publish(run);

    return run;
  }

  /** Продлить аренду; `false` — задача больше не выполняется. */
  extendLease(id: string, seconds: number): Promise<boolean> {
    return this._repo.extendLease(id, secondsFromNow(seconds));
  }

  /**
   * Точечный UPDATE изменённых полей и событие со свежим снимком. Переход в
   * итоговый статус — сигнал `job_settled` (в транзакции `manager`, если она
   * есть): его ждёт `JobQueue.request`.
   */
  async update(
    run: JobRun,
    patch: TJobRunPatch,
    manager?: EntityManager,
  ): Promise<JobRun> {
    const repo = manager ? manager.getRepository(JobRun) : this._repo;

    // jsonb-поля (`result`) типизированы `unknown` — TypeORM их не выводит.
    await repo.update({ id: run.id }, patch as QueryDeepPartialEntity<JobRun>);
    Object.assign(run, patch);

    if (patch.status && SETTLED_JOB_RUN_STATUSES.includes(patch.status)) {
      await this._signals.notify(JOB_SETTLED_CHANNEL, run.id, manager);
    }
    if (!manager) this.publish(run);

    return run;
  }

  progress(
    run: JobRun,
    value: number | undefined,
    text: string | undefined,
    lines: string[],
  ): Promise<JobRun> {
    return this.update(run, {
      ...(value !== undefined && { progress: clampProgress(value) }),
      ...(text !== undefined && {
        progressText: text.slice(0, PROGRESS_TEXT_MAX),
      }),
      ...(lines.length > 0 && { logTail: appendLogTail(run.logTail, lines) }),
    });
  }

  complete(
    run: JobRun,
    result: unknown,
    manager?: EntityManager,
  ): Promise<JobRun> {
    return this.update(
      run,
      {
        status: EJobRunStatus.COMPLETED,
        progress: 1,
        result: result ?? null,
        error: null,
        leaseUntil: null,
        finishedAt: new Date(),
      },
      manager,
    );
  }

  /** Ошибка попытки: `final` — повторов не будет, иначе задача снова в очереди. */
  fail(run: JobRun, error: IJobRunError, final: boolean): Promise<JobRun> {
    return this.update(run, {
      status: final ? EJobRunStatus.FAILED : EJobRunStatus.QUEUED,
      error,
      leaseUntil: null,
      finishedAt: final ? new Date() : null,
    });
  }

  cancelled(run: JobRun): Promise<JobRun> {
    return this.update(run, {
      status: EJobRunStatus.CANCELLED,
      cancelRequested: true,
      leaseUntil: null,
      finishedAt: new Date(),
    });
  }
}
