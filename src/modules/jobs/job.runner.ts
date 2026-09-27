import { inject, optional } from "inversify";
import type { JobResult, JobWithMetadata } from "pg-boss";

import {
  IJobHandler,
  IJobMetrics,
  Injectable,
  JOB_METRICS,
  JobContext,
  JobError,
  logger,
  requestContext,
} from "../../core";
import { JOB_CANCELLED_REASON, JobCancelWatcher } from "./job-cancel.watcher";
import { JobProgressWriter } from "./job-progress.writer";
import { JobRun } from "./job-run.entity";
import { JobRunTracker } from "./job-run.tracker";
import {
  EJobRunStatus,
  IJobRunError,
  JOB_INTERNAL_LEASE_SECONDS,
} from "./jobs.types";

interface IJobFailure extends IJobRunError {
  retryable: boolean;
}

/** Ошибка обработчика → код, сообщение и можно ли повторять. */
export const toJobFailure = (err: unknown): IJobFailure => {
  if (err instanceof JobError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }

  const message = err instanceof Error ? err.message : String(err);

  return { code: "JOB_FAILED", message, retryable: true };
};

/** pg-boss хранит результат объектом. */
export const toJobOutput = (value: unknown): object | undefined => {
  if (value === undefined || value === null) return undefined;

  return typeof value === "object" ? value : { value };
};

const isCancelled = (signal: AbortSignal): boolean =>
  signal.aborted && signal.reason === JOB_CANCELLED_REASON;

const isFinished = (run: JobRun): boolean =>
  run.status === EJobRunStatus.COMPLETED ||
  run.status === EJobRunStatus.CANCELLED;

/**
 * Выполнение задачи Node-обработчиком: контекст с сигналом отмены,
 * прогрессом и логом, корреляция логов `job:<queue>:<id>`, запись статуса
 * видимой задачи, решение о повторе и метрики.
 */
@Injectable()
export class JobRunner {
  constructor(
    @inject(JobRunTracker) private readonly _tracker: JobRunTracker,
    @inject(JobCancelWatcher) private readonly _watcher: JobCancelWatcher,
    @inject(JOB_METRICS) @optional() private readonly _metrics?: IJobMetrics,
  ) {}

  /**
   * Выполнить задачу; результат — исход для pg-boss (`perJobResults`):
   * `deadletter` завершает задачу без повторов.
   */
  run(
    handler: IJobHandler<unknown, unknown>,
    job: JobWithMetadata<unknown>,
    tracked: boolean,
  ): Promise<JobResult> {
    const { queue } = handler.definition;

    return requestContext.run({ requestId: `job:${queue}:${job.id}` }, () =>
      this.execute(handler, job, tracked),
    );
  }

  private async execute(
    handler: IJobHandler<unknown, unknown>,
    job: JobWithMetadata<unknown>,
    tracked: boolean,
  ): Promise<JobResult> {
    const { queue } = handler.definition;
    const startedAt = Date.now();
    const attempt = job.retryCount;
    const controller = new AbortController();
    // pg-boss прерывает задачу при остановке процесса и по таймауту.
    const onBossAbort = () => controller.abort(job.signal.reason ?? "shutdown");

    if (job.signal.aborted) onBossAbort();
    else job.signal.addEventListener("abort", onBossAbort, { once: true });

    const unwatch = this._watcher.watch(job.id, controller);
    let run: JobRun | null = null;
    let writer: JobProgressWriter | null = null;
    let leaseTimer: NodeJS.Timeout | null = null;
    let ok = false;

    this.metric(m => m.onStart(queue));

    try {
      run = await this._tracker.start({
        id: job.id,
        queue,
        attempt,
        leaseSeconds: JOB_INTERNAL_LEASE_SECONDS,
        createIfMissing: tracked,
      });

      if (run && (isFinished(run) || run.cancelRequested)) {
        if (!isFinished(run)) await this._tracker.cancelled(run);

        return { id: job.id, status: "completed" };
      }

      if (run) {
        const current = run;

        writer = new JobProgressWriter((value, text, lines) =>
          this._tracker.progress(current, value, text, lines),
        );
        leaseTimer = setInterval(
          () => {
            this._tracker
              .extendLease(current.id, JOB_INTERNAL_LEASE_SECONDS)
              .catch(err =>
                logger.warn({ err }, "[Jobs] Не удалось продлить аренду"),
              );
          },
          (JOB_INTERNAL_LEASE_SECONDS * 1000) / 3,
        );
        leaseTimer.unref();
      }

      const progressWriter = writer;
      const ctx: JobContext<unknown> = {
        id: job.id,
        queue,
        data: job.data,
        attempt,
        signal: controller.signal,
        progress: async (value, text) => {
          await progressWriter?.progress(value, text);
        },
        log: async line => {
          if (progressWriter) await progressWriter.log(line);
          else logger.debug({ line }, "[Jobs] log");
        },
      };

      logger.debug({ queue, jobId: job.id, attempt }, "[Jobs] Задача начата");

      const result = await handler.handle(ctx);

      await writer?.flush();

      if (isCancelled(controller.signal)) {
        if (run) await this._tracker.cancelled(run);

        return { id: job.id, status: "completed" };
      }

      if (run) await this._tracker.complete(run, result ?? null);
      ok = true;

      return { id: job.id, status: "completed", output: toJobOutput(result) };
    } catch (err) {
      await writer?.flush().catch(() => undefined);

      if (isCancelled(controller.signal)) {
        logger.info({ queue, jobId: job.id }, "[Jobs] Задача отменена");
        if (run) await this._tracker.cancelled(run).catch(() => undefined);

        return { id: job.id, status: "completed" };
      }

      return await this.fail(job, queue, run, err);
    } finally {
      writer?.dispose();
      if (leaseTimer) clearInterval(leaseTimer);
      unwatch();
      job.signal.removeEventListener("abort", onBossAbort);
      this.metric(m => m.onComplete(queue, Date.now() - startedAt, ok));
    }
  }

  private async fail(
    job: JobWithMetadata<unknown>,
    queue: string,
    run: JobRun | null,
    err: unknown,
  ): Promise<JobResult> {
    const { code, message, retryable } = toJobFailure(err);
    const final = !retryable || job.retryCount >= job.retryLimit;

    logger.error(
      {
        err,
        queue,
        jobId: job.id,
        attempt: job.retryCount,
        errorCode: code,
        final,
      },
      "[Jobs] Задача завершилась ошибкой",
    );

    if (run) {
      await this._tracker
        .fail(run, { code, message }, final)
        .catch(trackErr =>
          logger.error({ err: trackErr }, "[Jobs] Не удалось записать ошибку"),
        );
    }

    return {
      id: job.id,
      status: retryable ? "failed" : "deadletter",
      output: { code, message },
    };
  }

  private metric(fn: (metrics: IJobMetrics) => void): void {
    if (!this._metrics) return;

    try {
      fn(this._metrics);
    } catch (err) {
      logger.warn({ err }, "[Jobs] Метрики задач: ошибка хука");
    }
  }
}
