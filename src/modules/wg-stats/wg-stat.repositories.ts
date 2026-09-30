import { LessThan } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { WgNodeMetric } from "./wg-node-metric.entity";
import { WgStatHour } from "./wg-stat-hour.entity";
import { WgStatSample } from "./wg-stat-sample.entity";
import { EWgSeriesGroupBy } from "./wg-stats.types";

export interface ISeriesFilters {
  nodeId?: string;
  interfaceId?: string;
  peerId?: string;
  userId?: string;
  /** Только пиры, где пользователь сейчас держатель или создатель. */
  ownedBy?: string;
}

/** Строка агрегированной серии (сырые значения из SQL). */
export interface ISeriesRow {
  bucketEpoch: string;
  key: string;
  rxBytes: string;
  txBytes: string;
  rxPeakBps: string;
  txPeakBps: string;
}

const KEY_EXPR: Record<EWgSeriesGroupBy, string> = {
  [EWgSeriesGroupBy.Total]: "'total'",
  [EWgSeriesGroupBy.Node]: "stat.node_id::text",
  [EWgSeriesGroupBy.Interface]: "stat.interface_id::text",
  [EWgSeriesGroupBy.Peer]: "stat.peer_id::text",
};

const buildSeriesQuery = (
  table: string,
  filters: ISeriesFilters,
  groupBy: EWgSeriesGroupBy,
): { where: string; params: Record<string, unknown>; keyExpr: string } => {
  const conditions = ["stat.ts >= :from", "stat.ts < :to"];
  const params: Record<string, unknown> = {};

  if (filters.nodeId) {
    conditions.push("stat.node_id = :nodeId");
    params.nodeId = filters.nodeId;
  }
  if (filters.interfaceId) {
    conditions.push("stat.interface_id = :interfaceId");
    params.interfaceId = filters.interfaceId;
  }
  if (filters.peerId) {
    conditions.push("stat.peer_id = :peerId");
    params.peerId = filters.peerId;
  }
  if (filters.userId) {
    conditions.push("stat.user_id = :userId");
    params.userId = filters.userId;
  }
  if (filters.ownedBy) {
    conditions.push(
      "stat.peer_id IN (SELECT id FROM wg_peers WHERE user_id = :ownedBy OR created_by_id = :ownedBy)",
    );
    params.ownedBy = filters.ownedBy;
  }

  return {
    where: conditions.join(" AND "),
    params,
    keyExpr: KEY_EXPR[groupBy],
  };
};

@InjectableRepository(WgStatSample)
export class WgStatSampleRepository extends BaseRepository<WgStatSample> {
  async querySeries(
    filters: ISeriesFilters,
    groupBy: EWgSeriesGroupBy,
    from: Date,
    to: Date,
    stepSec: number,
  ): Promise<ISeriesRow[]> {
    const { where, params, keyExpr } = buildSeriesQuery(
      "wg_stat_samples",
      filters,
      groupBy,
    );

    return this.createQueryBuilder("stat")
      .select(
        `floor(extract(epoch from stat.ts) / :step) * :step`,
        "bucketEpoch",
      )
      .addSelect(keyExpr, "key")
      .addSelect("COALESCE(SUM(stat.rx_delta), 0)", "rxBytes")
      .addSelect("COALESCE(SUM(stat.tx_delta), 0)", "txBytes")
      .addSelect("COALESCE(MAX(stat.rx_peak_bps), 0)", "rxPeakBps")
      .addSelect("COALESCE(MAX(stat.tx_peak_bps), 0)", "txPeakBps")
      .where(where, { ...params, from, to, step: stepSec })
      .groupBy("1")
      .addGroupBy("2")
      .orderBy("1", "ASC")
      .getRawMany<ISeriesRow>();
  }

  /** Rollup сэмплов в часовые агрегаты за интервал [from, to). */
  async rollupHours(from: Date, to: Date): Promise<number> {
    const result = await this.manager.query(
      `INSERT INTO wg_stat_hours
         (peer_id, interface_id, node_id, user_id, ts,
          rx_delta, tx_delta, rx_peak_bps, tx_peak_bps, online_ratio)
       SELECT peer_id, interface_id, node_id,
              MAX(user_id::text)::uuid,
              date_trunc('hour', ts),
              SUM(rx_delta), SUM(tx_delta),
              MAX(rx_peak_bps), MAX(tx_peak_bps),
              AVG(online::int)
         FROM wg_stat_samples
        WHERE ts >= $1 AND ts < $2
        GROUP BY peer_id, interface_id, node_id, date_trunc('hour', ts)`,
      [from, to],
    );

    return Array.isArray(result) ? result.length : 0;
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const result = await this.delete({ ts: LessThan(cutoff) });

    return result.affected ?? 0;
  }
}

@InjectableRepository(WgStatHour)
export class WgStatHourRepository extends BaseRepository<WgStatHour> {
  async querySeries(
    filters: ISeriesFilters,
    groupBy: EWgSeriesGroupBy,
    from: Date,
    to: Date,
    stepSec: number,
  ): Promise<ISeriesRow[]> {
    const { where, params, keyExpr } = buildSeriesQuery(
      "wg_stat_hours",
      filters,
      groupBy,
    );

    return this.createQueryBuilder("stat")
      .select(
        `floor(extract(epoch from stat.ts) / :step) * :step`,
        "bucketEpoch",
      )
      .addSelect(keyExpr, "key")
      .addSelect("COALESCE(SUM(stat.rx_delta), 0)", "rxBytes")
      .addSelect("COALESCE(SUM(stat.tx_delta), 0)", "txBytes")
      .addSelect("COALESCE(MAX(stat.rx_peak_bps), 0)", "rxPeakBps")
      .addSelect("COALESCE(MAX(stat.tx_peak_bps), 0)", "txPeakBps")
      .where(where, { ...params, from, to, step: stepSec })
      .groupBy("1")
      .addGroupBy("2")
      .orderBy("1", "ASC")
      .getRawMany<ISeriesRow>();
  }

  /** Идемпотентный rollup: пересобрать часы интервала заново. */
  async clearRange(from: Date, to: Date): Promise<void> {
    await this.createQueryBuilder()
      .delete()
      .where("ts >= :from AND ts < :to", { from, to })
      .execute();
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const result = await this.delete({ ts: LessThan(cutoff) });

    return result.affected ?? 0;
  }
}

/** Строка агрегированных метрик ноды. */
export interface INodeMetricRow {
  bucketEpoch: string;
  cpuPercent: string;
  load1: string;
  memUsedBytes: string;
  memTotalBytes: string;
  diskUsedBytes: string;
  diskTotalBytes: string;
  uptimeSec: string;
}

@InjectableRepository(WgNodeMetric)
export class WgNodeMetricRepository extends BaseRepository<WgNodeMetric> {
  async queryRange(
    nodeId: string,
    from: Date,
    to: Date,
    stepSec: number,
  ): Promise<INodeMetricRow[]> {
    return this.createQueryBuilder("metric")
      .select(
        `floor(extract(epoch from metric.ts) / :step) * :step`,
        "bucketEpoch",
      )
      .addSelect("AVG(metric.cpu_percent)", "cpuPercent")
      .addSelect("AVG(metric.load1)", "load1")
      .addSelect("MAX(metric.mem_used_bytes)", "memUsedBytes")
      .addSelect("MAX(metric.mem_total_bytes)", "memTotalBytes")
      .addSelect("MAX(metric.disk_used_bytes)", "diskUsedBytes")
      .addSelect("MAX(metric.disk_total_bytes)", "diskTotalBytes")
      .addSelect("MAX(metric.uptime_sec)", "uptimeSec")
      .where("metric.node_id = :nodeId", { nodeId })
      .andWhere("metric.ts >= :from AND metric.ts < :to", { from, to })
      .setParameter("step", stepSec)
      .groupBy("1")
      .orderBy("1", "ASC")
      .getRawMany<INodeMetricRow>();
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const result = await this.delete({ ts: LessThan(cutoff) });

    return result.affected ?? 0;
  }
}
