import { inject } from "inversify";

import { Injectable } from "../../core";
import type { AuthContext } from "../../types/koa";
import { WgPeerRepository } from "../wg-peer";
import { WgLinkHealthService } from "./wg-link-health.service";
import { WgMeshService } from "./wg-mesh.service";
import type { ISeriesFilters, ISeriesRow } from "./wg-stat.repositories";
import {
  WgNodeMetricRepository,
  WgStatHourRepository,
  WgStatSampleRepository,
} from "./wg-stat.repositories";
import { WgStatsError } from "./wg-stats.errors";
import {
  EWgSeriesGroupBy,
  IWgInterfaceLive,
  IWgLinkHealth,
  IWgMeshMatrix,
  IWgNodeLive,
  IWgPeerLive,
  IWgSpeedPoint,
  WG_SERIES_HOURS_THRESHOLD_MS,
  WG_SERIES_MAX_POINTS,
  WG_SERIES_MIN_STEP_SEC,
} from "./wg-stats.types";
import { WgStatsOverviewService } from "./wg-stats-overview.service";

/** Точка серии. */
export interface IWgSeriesPointDto {
  ts: Date;
  /** Трафик за шаг, байты. */
  rxBytes: number;
  txBytes: number;
  /** Средняя скорость за шаг, Б/с. */
  rxBps: number;
  txBps: number;
  /** Пиковая скорость внутри шага, Б/с. */
  rxPeakBps: number;
  txPeakBps: number;
}

/** Серия статистики (одна на ключ группировки). */
export interface IWgSeriesDto {
  /** id ноды/интерфейса/пира или `total`. */
  key: string;
  points: IWgSeriesPointDto[];
}

export interface IWgSeriesQuery extends ISeriesFilters {
  from: Date;
  to: Date;
  stepSec?: number;
  groupBy?: EWgSeriesGroupBy;
}

/** Метрики ноды за период (агрегированные по шагу). */
export interface IWgNodeMetricPointDto {
  ts: Date;
  cpuPercent: number;
  load1: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  uptimeSec: number;
}

/** Гибкие выборки истории: скорость/трафик с фильтрами и группировкой. */
@Injectable()
export class WgStatsQueryService {
  constructor(
    @inject(WgStatSampleRepository)
    private readonly _samples: WgStatSampleRepository,
    @inject(WgStatHourRepository)
    private readonly _hours: WgStatHourRepository,
    @inject(WgNodeMetricRepository)
    private readonly _metrics: WgNodeMetricRepository,
    @inject(WgPeerRepository) private readonly _peers: WgPeerRepository,
    @inject(WgStatsOverviewService)
    private readonly _overview: WgStatsOverviewService,
    @inject(WgLinkHealthService) private readonly _links: WgLinkHealthService,
    @inject(WgMeshService) private readonly _mesh: WgMeshService,
  ) {}

  async series(
    actor: AuthContext,
    query: IWgSeriesQuery,
  ): Promise<IWgSeriesDto[]> {
    const scoped = this._scope(actor, query);
    const rangeMs = scoped.to.getTime() - scoped.from.getTime();

    if (!(rangeMs > 0)) throw WgStatsError.BAD_RANGE();

    const useHours = rangeMs > WG_SERIES_HOURS_THRESHOLD_MS;
    const minStep = useHours ? 3600 : WG_SERIES_MIN_STEP_SEC;
    const stepSec = Math.max(
      scoped.stepSec ?? 0,
      minStep,
      Math.ceil(rangeMs / 1000 / WG_SERIES_MAX_POINTS),
    );
    const groupBy = scoped.groupBy ?? EWgSeriesGroupBy.Total;
    const filters: ISeriesFilters = {
      nodeId: scoped.nodeId,
      interfaceId: scoped.interfaceId,
      peerId: scoped.peerId,
      userId: scoped.userId,
    };
    const rows = useHours
      ? await this._hours.querySeries(
          filters,
          groupBy,
          scoped.from,
          scoped.to,
          stepSec,
        )
      : await this._samples.querySeries(
          filters,
          groupBy,
          scoped.from,
          scoped.to,
          stepSec,
        );

    return this._toSeries(rows, stepSec);
  }

  /** Live-снимок пира: право view или свой пир с правом own. */
  async currentPeer(
    actor: AuthContext,
    peerId: string,
  ): Promise<IWgPeerLive | null> {
    await this._assertPeerAccess(actor, peerId);

    return this._overview.getPeerLive(peerId);
  }

  /** Короткий ряд скорости пира: доступ — как к снимку пира. */
  async peerWindow(
    actor: AuthContext,
    peerId: string,
  ): Promise<IWgSpeedPoint[]> {
    await this._assertPeerAccess(actor, peerId);

    return this._overview.getSpeedWindow("peer", peerId);
  }

  /** Короткий ряд скорости интерфейса (право `wg:stats:view`). */
  async interfaceWindow(
    actor: AuthContext,
    interfaceId: string,
  ): Promise<IWgSpeedPoint[]> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._overview.getSpeedWindow("iface", interfaceId);
  }

  /** Короткий ряд скорости ноды (право `wg:stats:view`). */
  async nodeWindow(
    actor: AuthContext,
    nodeId: string,
  ): Promise<IWgSpeedPoint[]> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._overview.getSpeedWindow("node", nodeId);
  }

  private async _assertPeerAccess(
    actor: AuthContext,
    peerId: string,
  ): Promise<void> {
    if (this._overview.canViewGlobal(actor)) return;

    const peer = await this._peers.findOne({ where: { id: peerId } });

    if (
      !peer ||
      peer.userId !== actor.userId ||
      !this._overview.canViewOwn(actor)
    ) {
      throw WgStatsError.FORBIDDEN();
    }
  }

  /** Live-снимок интерфейса (право `wg:stats:view`). */
  async currentInterface(
    actor: AuthContext,
    interfaceId: string,
  ): Promise<IWgInterfaceLive | null> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._overview.getInterfaceLive(interfaceId);
  }

  /** Live-снимок ноды с системными метриками (право `wg:stats:view`). */
  async currentNode(
    actor: AuthContext,
    nodeId: string,
  ): Promise<IWgNodeLive | null> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._overview.getNodeLive(nodeId);
  }

  /** Здоровье IPIP-линков ноды (право `wg:stats:view`). */
  async nodeLinks(
    actor: AuthContext,
    nodeId: string,
  ): Promise<IWgLinkHealth[]> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._links.forNode(nodeId);
  }

  /** Матрица связности нод (право `wg:stats:view`). */
  async mesh(actor: AuthContext): Promise<IWgMeshMatrix> {
    if (!this._overview.canViewGlobal(actor)) throw WgStatsError.FORBIDDEN();

    return this._mesh.matrix();
  }

  /** Системные метрики ноды за период (право `wg:node:view`). */
  async nodeMetrics(
    nodeId: string,
    from: Date,
    to: Date,
    stepSec?: number,
  ): Promise<IWgNodeMetricPointDto[]> {
    const rangeMs = to.getTime() - from.getTime();

    if (!(rangeMs > 0)) throw WgStatsError.BAD_RANGE();

    const step = Math.max(
      stepSec ?? 0,
      WG_SERIES_MIN_STEP_SEC,
      Math.ceil(rangeMs / 1000 / WG_SERIES_MAX_POINTS),
    );
    const rows = await this._metrics.queryRange(nodeId, from, to, step);

    return rows.map(row => ({
      ts: new Date(Number(row.bucketEpoch) * 1000),
      cpuPercent: Number(row.cpuPercent),
      load1: Number(row.load1),
      memUsedBytes: Number(row.memUsedBytes),
      memTotalBytes: Number(row.memTotalBytes),
      diskUsedBytes: Number(row.diskUsedBytes),
      diskTotalBytes: Number(row.diskTotalBytes),
      uptimeSec: Number(row.uptimeSec),
    }));
  }

  /** Без права view — только свои пиры и группировки total/peer. */
  private _scope(actor: AuthContext, query: IWgSeriesQuery): IWgSeriesQuery {
    if (this._overview.canViewGlobal(actor)) return query;
    if (!this._overview.canViewOwn(actor)) throw WgStatsError.FORBIDDEN();

    const groupBy =
      query.groupBy === EWgSeriesGroupBy.Peer
        ? EWgSeriesGroupBy.Peer
        : EWgSeriesGroupBy.Total;

    return {
      from: query.from,
      to: query.to,
      stepSec: query.stepSec,
      groupBy,
      peerId: query.peerId,
      userId: actor.userId,
    };
  }

  private _toSeries(rows: ISeriesRow[], stepSec: number): IWgSeriesDto[] {
    const byKey = new Map<string, IWgSeriesPointDto[]>();

    for (const row of rows) {
      const points = byKey.get(row.key) ?? [];
      const rxBytes = Number(row.rxBytes);
      const txBytes = Number(row.txBytes);

      points.push({
        ts: new Date(Number(row.bucketEpoch) * 1000),
        rxBytes,
        txBytes,
        rxBps: Math.round(rxBytes / stepSec),
        txBps: Math.round(txBytes / stepSec),
        rxPeakBps: Number(row.rxPeakBps),
        txPeakBps: Number(row.txPeakBps),
      });
      byKey.set(row.key, points);
    }

    return [...byKey.entries()].map(([key, points]) => ({ key, points }));
  }
}
