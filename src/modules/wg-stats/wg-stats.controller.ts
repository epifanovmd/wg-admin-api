import { inject } from "inversify";
import {
  Controller,
  Get,
  Path,
  Query,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  EWgSeriesGroupBy,
  IWgInterfaceLive,
  IWgLinkHealth,
  IWgMeshMatrix,
  IWgNodeLive,
  IWgOverview,
  IWgPeerLive,
  IWgSpeedPoint,
} from "./wg-stats.types";
import { WgStatsOverviewService } from "./wg-stats-overview.service";
import type {
  IWgNodeMetricPointDto,
  IWgSeriesDto,
} from "./wg-stats-query.service";
import { WgStatsQueryService } from "./wg-stats-query.service";

const DAY_MS = 24 * 3600 * 1000;

const defaultRange = (from?: Date, to?: Date): { from: Date; to: Date } => {
  const end = to ?? new Date();

  return { from: from ?? new Date(end.getTime() - DAY_MS), to: end };
};

@Injectable()
@Tags("WgStats")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/stats")
export class WgStatsController extends Controller {
  constructor(
    @inject(WgStatsOverviewService)
    private readonly _overview: WgStatsOverviewService,
    @inject(WgStatsQueryService)
    private readonly _query: WgStatsQueryService,
  ) {
    super();
  }

  /**
   * Сводка дашборда: с правом `wg:stats:view` — глобальная, с
   * `wg:stats:view:own` — по своим пирам (держатель или создатель).
   * @summary Сводка
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("overview")
  wgStatsOverview(@Request() req: KoaRequest): Promise<IWgOverview> {
    return this._overview.overviewFor(getContextUser(req));
  }

  /**
   * Серии скорости/трафика с фильтрами и группировкой. Диапазон по
   * умолчанию — последние 24 часа; шаг подбирается автоматически
   * (минуты, свыше 48 часов — часы). Без права `wg:stats:view`
   * возвращаются только собственные пиры.
   * @summary Серии статистики
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("series")
  wgStatsSeries(
    @Request() req: KoaRequest,
    @Query() from?: Date,
    @Query() to?: Date,
    @Query() stepSec?: number,
    @Query() groupBy?: EWgSeriesGroupBy,
    @Query() nodeId?: UUID,
    @Query() interfaceId?: UUID,
    @Query() peerId?: UUID,
    @Query() userId?: UUID,
  ): Promise<IWgSeriesDto[]> {
    return this._query.series(getContextUser(req), {
      ...defaultRange(from, to),
      stepSec,
      groupBy,
      nodeId,
      interfaceId,
      peerId,
      userId,
    });
  }

  /**
   * Текущий live-снимок пира (для первой отрисовки, дальше — сокет).
   * Держатель видит свои пиры; `null` — агент ещё не присылал статистику.
   * @summary Текущий снимок пира
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("current/peer/{peerId}")
  wgStatsCurrentPeer(
    @Request() req: KoaRequest,
    @Path() peerId: UUID,
  ): Promise<IWgPeerLive | null> {
    return this._query.currentPeer(getContextUser(req), peerId);
  }

  /**
   * Текущий live-снимок интерфейса. С областью «свои» — только свой
   * интерфейс (владелец или создатель).
   * @summary Текущий снимок интерфейса
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("current/interface/{interfaceId}")
  wgStatsCurrentInterface(
    @Request() req: KoaRequest,
    @Path() interfaceId: UUID,
  ): Promise<IWgInterfaceLive | null> {
    return this._query.currentInterface(getContextUser(req), interfaceId);
  }

  /**
   * Текущий live-снимок ноды с системными метриками. С областью «свои» —
   * только своя нода (владелец или создатель).
   * @summary Текущий снимок ноды
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("current/node/{nodeId}")
  wgStatsCurrentNode(
    @Request() req: KoaRequest,
    @Path() nodeId: UUID,
  ): Promise<IWgNodeLive | null> {
    return this._query.currentNode(getContextUser(req), nodeId);
  }

  /**
   * Скорость пира за последние минуты (для первой отрисовки графика,
   * дальше — сокет). Держатель видит свои пиры.
   * @summary Короткий ряд скорости пира
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("window/peer/{peerId}")
  wgStatsPeerWindow(
    @Request() req: KoaRequest,
    @Path() peerId: UUID,
  ): Promise<IWgSpeedPoint[]> {
    return this._query.peerWindow(getContextUser(req), peerId);
  }

  /**
   * Скорость интерфейса за последние минуты. С областью «свои» — только
   * свой интерфейс.
   * @summary Короткий ряд скорости интерфейса
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("window/interface/{interfaceId}")
  wgStatsInterfaceWindow(
    @Request() req: KoaRequest,
    @Path() interfaceId: UUID,
  ): Promise<IWgSpeedPoint[]> {
    return this._query.interfaceWindow(getContextUser(req), interfaceId);
  }

  /**
   * Скорость ноды за последние минуты. С областью «свои» — только своя нода.
   * @summary Короткий ряд скорости ноды
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("window/node/{nodeId}")
  wgStatsNodeWindow(
    @Request() req: KoaRequest,
    @Path() nodeId: UUID,
  ): Promise<IWgSpeedPoint[]> {
    return this._query.nodeWindow(getContextUser(req), nodeId);
  }

  /**
   * Связность нод: RTT и потери между публичными адресами (пробы агентов
   * раз в ~60 с).
   * @summary Матрица связности нод
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("mesh")
  wgStatsMesh(@Request() req: KoaRequest): Promise<IWgMeshMatrix> {
    return this._query.mesh(getContextUser(req));
  }

  /**
   * Здоровье IPIP-туннелей ноды: RTT и потери по каждому линку релея. С
   * областью «свои» — только своя нода.
   * @summary Туннели ноды
   */
  @Security("jwt", ["permission:wg:stats:view:own"])
  @Get("links/node/{nodeId}")
  wgStatsNodeLinks(
    @Request() req: KoaRequest,
    @Path() nodeId: UUID,
  ): Promise<IWgLinkHealth[]> {
    return this._query.nodeLinks(getContextUser(req), nodeId);
  }

  /**
   * Системные метрики ноды (CPU, память, диск) за период. С
   * `wg:node:view:own` — только своя нода.
   * @summary Метрики ноды
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get("node-metrics")
  wgNodeMetrics(
    @Request() req: KoaRequest,
    @Query() nodeId: UUID,
    @Query() from?: Date,
    @Query() to?: Date,
    @Query() stepSec?: number,
  ): Promise<IWgNodeMetricPointDto[]> {
    const range = defaultRange(from, to);

    return this._query.nodeMetrics(
      getContextUser(req),
      nodeId,
      range.from,
      range.to,
      stepSec,
    );
  }
}
