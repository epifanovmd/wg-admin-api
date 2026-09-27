import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobRunTracker } from "./job-run.tracker";
import { EJobRunStatus } from "./jobs.types";
import { PgBossService } from "./pg-boss.service";

/** Сколько задач обрабатывается за проход. */
const REAP_BATCH = 100;

const LEASE_EXPIRED = {
  code: "LEASE_EXPIRED",
  message: "Воркер перестал отвечать: аренда задачи истекла",
};

/**
 * Задачи, чей воркер пропал (аренда истекла): активную в pg-boss проваливаем
 * — она уходит на повтор или падает по политике очереди, — и запись
 * приводим к фактическому состоянию pg-boss.
 */
@Injectable()
export class JobLeaseReaper {
  constructor(
    @inject(JobRunRepository) private readonly _runs: JobRunRepository,
    @inject(JobRunTracker) private readonly _tracker: JobRunTracker,
    @inject(PgBossService) private readonly _boss: PgBossService,
  ) {}

  async reap(): Promise<number> {
    const expired = await this._runs.findExpiredLeases(new Date(), REAP_BATCH);

    for (const run of expired) {
      try {
        await this.reapOne(run);
      } catch (err) {
        logger.error(
          { err, jobId: run.id },
          "[Jobs] Не удалось вернуть задачу",
        );
      }
    }

    if (expired.length) {
      logger.warn({ count: expired.length }, "[Jobs] Истекла аренда задач");
    }

    return expired.length;
  }

  private async reapOne(run: JobRun): Promise<void> {
    let ref = await this._boss.findJob(run.id);

    if (ref?.state === "active") {
      const boss = await this._boss.ready();

      await boss.fail(run.queue, run.id, LEASE_EXPIRED);
      ref = await this._boss.findJob(run.id);
    }

    switch (ref?.state) {
      case "created":
      case "retry":
        await this._tracker.fail(run, LEASE_EXPIRED, false);
        break;
      case "active":
        // Задачу уже взял другой воркер — его запись и обновит.
        break;
      case "completed":
        await this._tracker.update(run, {
          status: EJobRunStatus.COMPLETED,
          leaseUntil: null,
          finishedAt: new Date(),
        });
        break;
      case "cancelled":
        await this._tracker.cancelled(run);
        break;
      default:
        await this._tracker.fail(run, LEASE_EXPIRED, true);
    }
  }
}
