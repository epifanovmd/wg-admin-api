import type { TokenProvider } from "../decorators";
import { Injectable } from "../decorators";
import type { IJobMetrics } from "../jobs/jobs.types";
import { JOB_METRICS } from "../jobs/jobs.types";
import { jobDuration, jobsActive, jobsTotal } from "./metrics";

/**
 * Реализация хука `JOB_METRICS` (контракт — `core/jobs`) на prom-client:
 * `jobs_active`, `jobs_total{queue,outcome}`, `job_duration_seconds`.
 */
@Injectable()
export class PrometheusJobMetrics implements IJobMetrics {
  onStart(queue: string): void {
    jobsActive.inc({ queue });
  }

  onComplete(queue: string, durationMs: number, ok: boolean): void {
    const outcome = ok ? "completed" : "failed";

    jobsActive.dec({ queue });
    jobsTotal.inc({ queue, outcome });
    jobDuration.observe({ queue, outcome }, durationMs / 1000);
  }
}

export const jobMetricsProvider: TokenProvider<IJobMetrics> = {
  provide: JOB_METRICS,
  useClass: PrometheusJobMetrics,
};
