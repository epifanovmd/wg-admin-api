import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { wgConfig } from "../wg-node";
import {
  WgNodeMetricRepository,
  WgStatHourRepository,
  WgStatSampleRepository,
} from "./wg-stat.repositories";

const HOUR_MS = 3600 * 1000;

const hourStart = (ts: number): Date =>
  new Date(Math.floor(ts / HOUR_MS) * HOUR_MS);

/** Ежечасный rollup сэмплов в часовые агрегаты (последние два часа). */
@Injectable()
export class WgStatsRollupJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.stats-rollup",
    cron: "7 * * * *",
    retryLimit: 2,
  };

  constructor(
    @inject(WgStatSampleRepository)
    private readonly _samples: WgStatSampleRepository,
    @inject(WgStatHourRepository)
    private readonly _hours: WgStatHourRepository,
  ) {}

  async handle(): Promise<void> {
    const to = hourStart(Date.now());
    const from = new Date(to.getTime() - 2 * HOUR_MS);

    // Идемпотентно: интервал пересобирается заново.
    await this._hours.clearRange(from, to);
    await this._samples.rollupHours(from, to);
  }
}

/** Ежедневная чистка истории по срокам хранения. */
@Injectable()
export class WgStatsRetentionJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.stats-retention",
    cron: "40 3 * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(WgStatSampleRepository)
    private readonly _samples: WgStatSampleRepository,
    @inject(WgStatHourRepository)
    private readonly _hours: WgStatHourRepository,
    @inject(WgNodeMetricRepository)
    private readonly _metrics: WgNodeMetricRepository,
  ) {}

  async handle(): Promise<void> {
    const day = 24 * HOUR_MS;
    const samples = await this._samples.deleteBefore(
      new Date(Date.now() - wgConfig.statsSampleRetentionDays * day),
    );
    const hours = await this._hours.deleteBefore(
      new Date(Date.now() - wgConfig.statsHourRetentionDays * day),
    );
    const metrics = await this._metrics.deleteBefore(
      new Date(Date.now() - wgConfig.nodeMetricRetentionDays * day),
    );

    if (samples + hours + metrics > 0) {
      logger.info({ samples, hours, metrics }, "[WG] stats history pruned");
    }
  }
}
