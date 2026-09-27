import { inject } from "inversify";

import { config } from "../../config";
import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { JobRunRepository } from "./job-run.repository";
import { JOB_RETENTION_QUEUE } from "./jobs.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Раз в сутки удаляет завершённые записи задач старше `JOBS_RETENTION_DAYS`.
 */
@Injectable()
export class JobRetentionJobHandler implements IJobHandler<object, number> {
  readonly definition: JobDefinition = {
    queue: JOB_RETENTION_QUEUE,
    cron: "30 3 * * *",
    retryLimit: 1,
    expireInSeconds: 600,
  };

  constructor(
    @inject(JobRunRepository) private readonly _runs: JobRunRepository,
  ) {}

  async handle(): Promise<number> {
    const before = new Date(Date.now() - config.jobs.retentionDays * DAY_MS);
    const removed = await this._runs.deleteSettledBefore(before);

    if (removed) {
      logger.info({ removed }, "[Jobs] Удалены старые записи задач");
    }

    return removed;
  }
}
