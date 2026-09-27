import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition } from "../../core";
import { JobLeaseReaper } from "./job-lease.reaper";
import { LEASE_REAPER_QUEUE } from "./jobs.types";

/** Раз в минуту возвращает задачи с истёкшей арендой. */
@Injectable()
export class LeaseReaperJobHandler implements IJobHandler<object, number> {
  readonly definition: JobDefinition = {
    queue: LEASE_REAPER_QUEUE,
    cron: "* * * * *",
    retryLimit: 0,
    expireInSeconds: 120,
  };

  constructor(
    @inject(JobLeaseReaper) private readonly _reaper: JobLeaseReaper,
  ) {}

  handle(): Promise<number> {
    return this._reaper.reap();
  }
}
