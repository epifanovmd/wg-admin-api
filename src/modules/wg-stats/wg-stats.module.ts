import { asJobHandler, Module } from "../../core";
import { asSocketListener, asSocketRoomPolicy } from "../socket";
import {
  WgStatsRetentionJob,
  WgStatsRollupJob,
} from "./stats-maintenance.jobs";
import { WgLinkHealthService } from "./wg-link-health.service";
import { WgLiveStore } from "./wg-live-store.service";
import { WgMeshService } from "./wg-mesh.service";
import { WgNodeMetric } from "./wg-node-metric.entity";
import { WgOverviewRoomPolicy } from "./wg-overview-room.policy";
import { WgSeedBootstrap } from "./wg-seed.bootstrap";
import {
  WgNodeMetricRepository,
  WgStatHourRepository,
  WgStatSampleRepository,
} from "./wg-stat.repositories";
import { WgStatHour } from "./wg-stat-hour.entity";
import { WgStatSample } from "./wg-stat-sample.entity";
import { WgStatsController } from "./wg-stats.controller";
import { WgStatsListener } from "./wg-stats.listener";
import { WgStatsIngestService } from "./wg-stats-ingest.service";
import { WgStatsOverviewService } from "./wg-stats-overview.service";
import { WgStatsQueryService } from "./wg-stats-query.service";
import { WgViewerDemandService } from "./wg-viewer-demand.service";

@Module({
  entities: [WgStatSample, WgStatHour, WgNodeMetric],
  providers: [
    WgStatSampleRepository,
    WgStatHourRepository,
    WgNodeMetricRepository,
    WgLiveStore,
    WgStatsOverviewService,
    WgViewerDemandService,
    WgStatsIngestService,
    WgLinkHealthService,
    WgMeshService,
    WgStatsQueryService,
    WgStatsController,
    asSocketRoomPolicy(WgOverviewRoomPolicy),
    asSocketListener(WgStatsListener),
    asJobHandler(WgStatsRollupJob),
    asJobHandler(WgStatsRetentionJob),
  ],
  bootstrappers: [WgSeedBootstrap],
})
export class WgStatsModule {}
