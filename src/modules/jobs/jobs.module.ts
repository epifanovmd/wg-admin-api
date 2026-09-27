import { asHealthIndicator, asJobHandler, JobQueue, Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import { JobRunner } from "./job.runner";
import { JobCancelWatcher } from "./job-cancel.watcher";
import { JobHandlerRegistry } from "./job-handler.registry";
import { JobLeaseReaper } from "./job-lease.reaper";
import { JobResultWaiter } from "./job-result.waiter";
import { JobRetentionJobHandler } from "./job-retention.handler";
import { JobRoomPolicy } from "./job-room.policy";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobRunTracker } from "./job-run.tracker";
import { JobSignals } from "./job-signals";
import { JobsBootstrap } from "./jobs.bootstrap";
import { JobsController } from "./jobs.controller";
import { JobsHealthIndicator } from "./jobs.health";
import { JobsSocketListener } from "./jobs.listener";
import { JobsService } from "./jobs.service";
import { LeaseReaperJobHandler } from "./lease-reaper.handler";
import { PgBossService } from "./pg-boss.service";
import { PgBossJobQueue } from "./pg-boss-job.queue";

/** Очередь задач (pg-boss): обработчики, cron, видимые задачи. */
@Module({
  entities: [JobRun],
  providers: [
    asHealthIndicator(JobsHealthIndicator),
    PgBossService,
    JobRunRepository,
    JobRunTracker,
    JobHandlerRegistry,
    JobSignals,
    JobCancelWatcher,
    JobResultWaiter,
    JobRunner,
    JobLeaseReaper,
    { provide: JobQueue, useClass: PgBossJobQueue },
    JobsService,
    JobsController,
    asSocketListener(JobsSocketListener),
    asSocketRoomPolicy(JobRoomPolicy),
    asJobHandler(LeaseReaperJobHandler),
    asJobHandler(JobRetentionJobHandler),
  ],
  bootstrappers: [JobsBootstrap],
})
export class JobsModule {}
