import { inject } from "inversify";

import {
  type AgentConfigAppliedEvent,
  type IAgentMetrics,
  Injectable,
} from "../../core";
import { WgForwardService } from "../wg-forward";
import {
  EWgInterfaceStatus,
  WgInterfaceReplicaService,
  WgInterfaceService,
} from "../wg-interface";
import {
  SOCKS_WORKER,
  WG_STATE_CONFIG,
  WG_WORKER,
  WgNode,
  WgNodeService,
  workerOsInfoPatch,
} from "../wg-node";
import { WgSocksAppService } from "../wg-socks";
import {
  IWgNodeSysMetrics,
  WgLinkHealthService,
  WgLiveStore,
  WgMeshService,
  WgStatsIngestService,
} from "../wg-stats";
import {
  ISocksWorkerMetrics,
  IWgForwardRouteReport,
  IWgNodeInfoEvent,
  IWgStateResult,
  IWgWorkerMetrics,
} from "./wg-worker.contract";

/** Предел текста ошибки применения. */
const APPLY_ERROR_MAX = 4000;

/** Длина версии wg в колонке. */
const WG_VERSION_MAX = 64;

/**
 * Сколько помнить принятые точки метрик, с: агент пересылает пачку, ответ на
 * которую до него не дошёл, — повтор старых счётчиков после новых ingest
 * принял бы за сброс счётчика. Повтор идёт сразу за потерянным ответом.
 */
const POINT_SEEN_TTL_SEC = 10 * 60;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const objectOf = <T>(value: unknown): T | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : undefined;

const INTERFACE_STATUSES = new Set<string>(Object.values(EWgInterfaceStatus));

/**
 * Метрики узла от агента (`sysmetrics`) → метрики ноды прежнего вида: CPU,
 * нагрузка, память, корневой диск, аптайм, скорость сетевых интерфейсов,
 * conntrack. Нет группы — нет поля.
 */
export const sysMetricsOf = (
  host: Record<string, unknown> | undefined,
): IWgNodeSysMetrics | undefined => {
  if (!host) return undefined;

  const nics = Array.isArray(host.interfaces)
    ? (host.interfaces as Array<Record<string, unknown>>)
        .filter(nic => typeof nic.name === "string")
        .map(nic => ({
          name: nic.name as string,
          rxBps: num(nic.rxBps) ?? 0,
          txBps: num(nic.txBps) ?? 0,
        }))
    : undefined;

  return {
    cpuPercent: num(host.cpuPercent) ?? 0,
    load1: num(host.load1) ?? 0,
    ...(num(host.load5) !== undefined && { load5: num(host.load5) }),
    ...(num(host.load15) !== undefined && { load15: num(host.load15) }),
    ...(nics && { nics }),
    conntrackCount: num(host.conntrack) ?? null,
    conntrackMax: num(host.conntrackMax) ?? null,
    memUsedBytes: num(host.memUsedBytes) ?? 0,
    memTotalBytes: num(host.memTotalBytes) ?? 0,
    diskUsedBytes: num(host.diskUsedBytes) ?? 0,
    diskTotalBytes: num(host.diskTotalBytes) ?? 0,
    uptimeSec: num(host.uptimeSec) ?? 0,
  };
};

/** Текст ошибки применения из итога; ошибок нет — `null`. */
export const applyErrorOf = (result: IWgStateResult): string | null => {
  const errors = (result.errors ?? []).filter(Boolean);

  return errors.length ? errors.join("; ").slice(0, APPLY_ERROR_MAX) : null;
};

/**
 * Данные воркеров ноды → домен: точки метрик (пиры, метрики узла, пробы
 * туннелей и нод, маршруты пробросов, прокси), итоги применения желаемого
 * состояния (применённая версия, ошибка, статусы интерфейсов, маршруты) и
 * сведения об узле от воркера wg.
 */
@Injectable()
export class WgAgentTelemetryService {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgInterfaceService)
    private readonly _interfaces: WgInterfaceService,
    @inject(WgInterfaceReplicaService)
    private readonly _replicas: WgInterfaceReplicaService,
    @inject(WgStatsIngestService)
    private readonly _ingest: WgStatsIngestService,
    @inject(WgLinkHealthService) private readonly _links: WgLinkHealthService,
    @inject(WgMeshService) private readonly _mesh: WgMeshService,
    @inject(WgForwardService) private readonly _forwards: WgForwardService,
    @inject(WgSocksAppService) private readonly _socks: WgSocksAppService,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
  ) {}

  /**
   * Точка метрик агента: статистика пиров и узла — в историю и живые
   * события; пробы и маршруты — состояние «сейчас», из досылки не берутся.
   * Повтор точки (та же `at` от того же агента, в любой копии API) — пропуск.
   */
  async onMetrics(agentId: string, point: IAgentMetrics): Promise<void> {
    const node = await this._nodes.findByAgentId(agentId);

    if (!node) return;
    if (
      (await this._live.incrBy(
        `agent-point:${agentId}:${point.at}`,
        1,
        POINT_SEEN_TTL_SEC,
      )) > 1
    ) {
      return;
    }

    const wg = objectOf<IWgWorkerMetrics>(point.workers?.[WG_WORKER]);
    const socks = objectOf<ISocksWorkerMetrics>(point.workers?.[SOCKS_WORKER]);
    const sys = sysMetricsOf(point.host);
    const result = await this._ingest.ingest(node, {
      collectedAt: point.at,
      ...(sys && { sys }),
      interfaces: Array.isArray(wg?.interfaces) ? wg.interfaces : [],
    });

    if (result.backfill) return;

    if (Array.isArray(wg?.tunnels)) {
      await this._links.recordProbes(node.id, wg.tunnels);
    }
    if (Array.isArray(wg?.forwards))
      await this._recordRoutes(node, wg.forwards);
    if (Array.isArray(wg?.nodeProbes)) {
      await this._mesh.recordProbes(node.id, wg.nodeProbes);
    }
    if (Array.isArray(socks?.proxies)) {
      await this._socks.recordStats(node.id, socks.proxies);
    }
  }

  /**
   * Воркер отказал в настройке `wg/state` (не прошла проверку) — ошибка
   * применения ноды. Применённая — итог придёт событием `state.result`.
   */
  async onConfigApplied(event: AgentConfigAppliedEvent): Promise<void> {
    if (event.worker !== WG_WORKER || event.key !== WG_STATE_CONFIG) return;
    if (event.ok !== false) return;

    const node = await this._nodes.findByAgentId(event.agentId);

    if (!node) return;

    await this._nodes.applyAgentState(node.id, {
      applyError: (
        event.error?.message ??
        event.error?.code ??
        "Настройка не применена"
      ).slice(0, APPLY_ERROR_MAX),
    });
  }

  /** Событие `state.result` воркера wg: итог применения. */
  async onStateResult(agentId: string, data: unknown): Promise<void> {
    const result = objectOf<IWgStateResult>(data);
    const node = result ? await this._nodes.findByAgentId(agentId) : null;

    if (node && result) await this.applyResult(node, result);
  }

  /** Событие `route.changed` воркера wg: маршруты пробросов по пробам. */
  async onRouteChanged(agentId: string, data: unknown): Promise<void> {
    const routes = objectOf<{ routes?: unknown }>(data)?.routes;
    const node = Array.isArray(routes)
      ? await this._nodes.findByAgentId(agentId)
      : null;

    if (node) await this._recordRoutes(node, routes as IWgForwardRouteReport[]);
  }

  /**
   * Событие `node.info` воркера wg: версия и режим WireGuard, дистрибутив,
   * ядро и занятые порты — в сведения ноды (поверх сведений агента).
   */
  async onNodeInfo(agentId: string, data: unknown): Promise<void> {
    const info = objectOf<IWgNodeInfoEvent>(data);
    const node = info ? await this._nodes.findByAgentId(agentId) : null;

    if (!node || !info) return;

    await this._nodes.applyAgentState(node.id, {
      osInfoPatch: workerOsInfoPatch(info),
      wgVersion:
        typeof info.wgVersion === "string" && info.wgVersion
          ? info.wgVersion.slice(0, WG_VERSION_MAX)
          : null,
    });
  }

  /**
   * Итог применения: версия (только растёт; итог старой версии не
   * перетирает ошибку новой), ошибка, статусы интерфейсов, маршруты.
   */
  async applyResult(node: WgNode, result: IWgStateResult): Promise<void> {
    if (typeof result.version !== "number") return;
    if (result.version < node.appliedVersion) return;

    await this._nodes.applyAgentState(node.id, {
      appliedVersion: result.version,
      applyError: applyErrorOf(result),
    });
    if (Array.isArray(result.interfaces)) {
      await this._interfaces.updateReportedStatuses(
        node.id,
        result.interfaces.map(report => ({
          name: report.name,
          status: INTERFACE_STATUSES.has(report.status)
            ? (report.status as EWgInterfaceStatus)
            : EWgInterfaceStatus.Unknown,
          message: report.message ?? null,
        })),
      );
    }
    if (Array.isArray(result.routes)) {
      await this._recordRoutes(node, result.routes);
    }
  }

  private async _recordRoutes(
    node: WgNode,
    routes: IWgForwardRouteReport[],
  ): Promise<void> {
    const valid = routes.filter(route => typeof route?.id === "string");

    await this._forwards.recordRoutes(node.id, valid);
    await this._replicas.recordServingNodes(node.id, valid);
  }
}
