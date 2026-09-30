import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import type { WgInterface } from "../wg-interface";
import { WgInterfaceRepository } from "../wg-interface";
import type { WgNode } from "../wg-node";
import type { IWgPeerStatsUpdate, WgPeer } from "../wg-peer";
import { isPeerOnline, WgPeerRepository, WgPeerService } from "../wg-peer";
import {
  WgInterfaceLiveStatsEvent,
  WgNodeLiveStatsEvent,
  WgOverviewUpdatedEvent,
  WgPeersLiveStatsEvent,
} from "./events";
import { WgLiveStore } from "./wg-live-store.service";
import {
  WgNodeMetricRepository,
  WgStatSampleRepository,
} from "./wg-stat.repositories";
import { WgStatSample } from "./wg-stat-sample.entity";
import {
  EWgAgentTransport,
  IWgInterfaceLive,
  IWgNodeLive,
  IWgNodeSysMetrics,
  IWgPeerLive,
  IWgSpeedPoint,
  WG_DB_WRITE_INTERVAL_MS,
  WG_LIVE_EMIT_DEADBAND_BPS,
  WG_LIVE_EMIT_MAX_SILENCE_MS,
  WG_SPEED_WINDOW_POINTS,
} from "./wg-stats.types";
import { speedBps } from "./wg-stats-math";
import { WgStatsOverviewService } from "./wg-stats-overview.service";
import { WgViewerDemandService } from "./wg-viewer-demand.service";

/** Статистика одного пира из `wg show dump` на агенте. */
export interface IWgAgentPeerStat {
  publicKey: string;
  rxBytes: number;
  txBytes: number;
  /** Unix-время последнего handshake (сек), 0/null — не было. */
  lastHandshake: number | null;
  endpoint: string | null;
}

export interface IWgAgentInterfaceStat {
  name: string;
  peers: IWgAgentPeerStat[];
}

/** Тик статистики агента: данные и (необязательно) нумерация и время сбора. */
export interface IWgAgentStatsReport {
  seq?: number;
  bootId?: string;
  collectedAt?: number;
  sentAt?: number;
  sys?: IWgNodeSysMetrics;
  interfaces: IWgAgentInterfaceStat[];
}

/** Итог приёма тика. */
export interface IWgIngestResult {
  /** Тик уже принимался (повтор при досылке) — данные не учтены. */
  duplicate: boolean;
  /** Тик досылки: учтён в истории, живых событий нет. */
  backfill: boolean;
}

/** Последние сырые счётчики wg пира на конкретной ноде. */
interface IRawCounters {
  rx: number;
  tx: number;
}

/** Последний принятый тик ноды: повтор с тем же запуском и номером отбрасывается. */
interface ILastTick {
  bootId: string;
  seq: number;
}

interface ILastWrite {
  ts: number;
  rxTotal: number;
  txTotal: number;
  rxPeakBps: number;
  txPeakBps: number;
  online: boolean;
}

interface ILastEmit {
  ts: number;
  rxBps: number;
  txBps: number;
  online: boolean;
}

interface IPeerMapCache {
  version: number;
  expiresAt: number;
  interfacesByName: Map<string, WgInterface>;
  peersByKey: Map<string, WgPeer>;
}

interface IPeerMatch {
  iface: WgInterface;
  peer: WgPeer;
  stat: IWgAgentPeerStat;
}

/** Тик, собранный в пределах этого окна, — «живой», старше — досылка. */
const FRESH_MS = 10_000;
/** Досылка старше часа не попадает в историю (скорость не восстановить). */
const MAX_BACKFILL_MS = 3_600_000;
/** Карта пиров ноды живёт до смены версии конфигурации ноды или этого срока. */
const PEER_MAP_TTL_MS = 60_000;
/** Сводка пересобирается не чаще этого интервала (на процесс). */
const OVERVIEW_MIN_INTERVAL_MS = 1000;
const LIVE_TTL_SEC = 300;
const COUNTER_TTL_SEC = 3600;
const TICK_TTL_SEC = 86_400;
const WINDOW_TTL_SEC = 900;

/**
 * Приращение монотонного трафика по сырому счётчику wg ноды: сброс (rekey,
 * перезапуск интерфейса) — счётчик начался заново, всё значение новое.
 * Первый отчёт ноды: прирост сверх уже накопленного (для одной ноды итог —
 * max(накоплено, raw); реплика с малым своим счётчиком — 0).
 */
const counterDelta = (
  prevRaw: number | null,
  raw: number,
  accumulated: number,
): number => {
  if (prevRaw === null) return Math.max(0, raw - accumulated);

  return raw >= prevRaw ? raw - prevRaw : raw;
};

/**
 * Момент сбора тика по часам сервера: задержка доставки считается по часам
 * агента (`sentAt − collectedAt`), поэтому расхождение часов не влияет.
 * Без полей тика — момент приёма.
 */
export const tickTime = (
  report: Pick<IWgAgentStatsReport, "collectedAt" | "sentAt">,
  now: number,
): number => {
  if (report.collectedAt === undefined || report.sentAt === undefined) {
    return now;
  }

  const delay = Math.min(
    Math.max(0, report.sentAt - report.collectedAt),
    MAX_BACKFILL_MS,
  );

  return now - delay;
};

const sum = <T>(items: T[], value: (item: T) => number): number =>
  items.reduce((total, item) => total + value(item), 0);

const point = (live: {
  ts: string;
  rxBps: number;
  txBps: number;
}): IWgSpeedPoint => ({
  ts: Date.parse(live.ts),
  rxBps: live.rxBps,
  txBps: live.txBps,
});

/**
 * Приём статистики от агентов: монотонные счётчики с компенсацией сбросов,
 * живые снимки и короткие ряды скорости в Redis, события в сокет (при спросе —
 * каждый тик, иначе — при заметном изменении), история в БД раз в минуту.
 * Все пиры тика обрабатываются пакетно: несколько запросов к Redis и по одному
 * запросу вставки истории и обновления пиров.
 */
@Injectable()
export class WgStatsIngestService {
  private readonly _peerMaps = new Map<string, IPeerMapCache>();
  private readonly _lastEmits = new Map<string, ILastEmit>();
  private _overviewAt = 0;

  constructor(
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgPeerRepository) private readonly _peers: WgPeerRepository,
    @inject(WgPeerService) private readonly _peerService: WgPeerService,
    @inject(WgStatSampleRepository)
    private readonly _samples: WgStatSampleRepository,
    @inject(WgNodeMetricRepository)
    private readonly _metrics: WgNodeMetricRepository,
    @inject(WgLiveStore) private readonly _live: WgLiveStore,
    @inject(WgStatsOverviewService)
    private readonly _overview: WgStatsOverviewService,
    @inject(WgViewerDemandService)
    private readonly _demand: WgViewerDemandService,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  async ingest(
    node: WgNode,
    report: IWgAgentStatsReport,
    transport: EWgAgentTransport | null = null,
  ): Promise<IWgIngestResult> {
    const now = Date.now();

    if (await this._isDuplicate(node.id, report)) {
      return { duplicate: true, backfill: false };
    }

    const at = tickTime(report, now);
    const fresh = now - at <= FRESH_MS;

    if (now - at > MAX_BACKFILL_MS) {
      return { duplicate: false, backfill: true };
    }

    // При открытой админке события уходят каждый тик, без порога.
    const everyTick = fresh && (await this._demand.isWatched());
    const map = await this._peerMap(node);
    const matches: IPeerMatch[] = [];
    const reportedInterfaces: WgInterface[] = [];

    for (const ifaceStat of report.interfaces) {
      const iface = map.interfacesByName.get(ifaceStat.name);

      if (!iface) continue;
      reportedInterfaces.push(iface);

      for (const stat of ifaceStat.peers) {
        const peer = map.peersByKey.get(`${iface.id}:${stat.publicKey}`);

        if (peer) matches.push({ iface, peer, stat });
      }
    }

    const peerLives = await this._ingestPeers(
      node,
      matches,
      at,
      fresh,
      everyTick,
    );
    const interfaceLives = await this._ingestInterfaces(
      node,
      reportedInterfaces,
      peerLives,
      at,
      fresh,
      everyTick,
    );

    await this._ingestNode(
      node,
      interfaceLives,
      report.sys ?? null,
      transport,
      at,
      fresh,
      everyTick,
    );

    if (fresh) await this._maybeRebuildOverview(now, everyTick);

    return { duplicate: false, backfill: !fresh };
  }

  /** Повтор тика того же запуска агента (досылка после разрыва связи). */
  private async _isDuplicate(
    nodeId: string,
    report: IWgAgentStatsReport,
  ): Promise<boolean> {
    if (report.seq === undefined || !report.bootId) return false;

    const key = `tick:${nodeId}`;
    const last = await this._live.getJson<ILastTick>(key);

    if (last && last.bootId === report.bootId && report.seq <= last.seq) {
      return true;
    }

    await this._live.setJson(
      key,
      { bootId: report.bootId, seq: report.seq },
      TICK_TTL_SEC,
    );

    return false;
  }

  private async _ingestPeers(
    node: WgNode,
    matches: IPeerMatch[],
    at: number,
    fresh: boolean,
    everyTick: boolean,
  ): Promise<IWgPeerLive[]> {
    if (matches.length === 0) return [];

    const count = matches.length;
    const stored = await this._live.getJsonMany<unknown>([
      ...matches.map(({ peer }) => `raw:${peer.id}:${node.id}`),
      ...matches.map(({ peer }) => `peer:${peer.id}`),
      ...matches.map(({ peer }) => `lw:peer:${peer.id}`),
    ]);
    const raws = stored.slice(0, count) as (IRawCounters | null)[];
    const prevs = stored.slice(count, count * 2) as (IWgPeerLive | null)[];
    const lastWrites = stored.slice(count * 2) as (ILastWrite | null)[];

    // Реплики: тот же пир приходит с нескольких нод, счётчики wg у каждой
    // свои — приращение считается по паре (пир, нода) и атомарно прибавляется
    // к общему накопителю пира.
    const accumulated = await this._live.setIfAbsentMany(
      matches.flatMap(({ peer }) => [
        [`acc:rx:${peer.id}`, peer.rxBytesTotal] as const,
        [`acc:tx:${peer.id}`, peer.txBytesTotal] as const,
      ]),
      COUNTER_TTL_SEC,
    );
    const deltas = matches.map(({ stat }, index) => ({
      rx: counterDelta(
        raws[index]?.rx ?? null,
        stat.rxBytes,
        accumulated[index * 2],
      ),
      tx: counterDelta(
        raws[index]?.tx ?? null,
        stat.txBytes,
        accumulated[index * 2 + 1],
      ),
    }));
    const increments = matches.flatMap(({ peer }, index) => [
      ...(deltas[index].rx
        ? [[`acc:rx:${peer.id}`, deltas[index].rx] as const]
        : []),
      ...(deltas[index].tx
        ? [[`acc:tx:${peer.id}`, deltas[index].tx] as const]
        : []),
    ]);
    const incremented = new Map<string, number>();

    (await this._live.incrByMany(increments, COUNTER_TTL_SEC)).forEach(
      (total, index) => incremented.set(increments[index][0], total),
    );

    const lives: IWgPeerLive[] = [];
    const liveWrites: [string, IWgPeerLive][] = [];
    const windowWrites: [string, IWgSpeedPoint][] = [];
    const lastWriteUpdates: [string, ILastWrite][] = [];
    const sampleRows: Partial<WgStatSample>[] = [];
    const peerUpdates: IWgPeerStatsUpdate[] = [];
    const emitted: IWgPeerLive[] = [];

    matches.forEach(({ iface, peer, stat }, index) => {
      const prev = prevs[index];
      const rxTotal =
        incremented.get(`acc:rx:${peer.id}`) ?? accumulated[index * 2];
      const txTotal =
        incremented.get(`acc:tx:${peer.id}`) ?? accumulated[index * 2 + 1];
      const statHandshakeAt =
        stat.lastHandshake && stat.lastHandshake > 0
          ? new Date(stat.lastHandshake * 1000)
          : null;
      const prevHandshakeAt = prev?.lastHandshakeAt
        ? new Date(prev.lastHandshakeAt)
        : null;
      // Клиент подключён к одной реплике: её рукопожатие и адрес — свежее.
      const fromThisNode =
        !prev ||
        prev.nodeId === node.id ||
        (statHandshakeAt !== null &&
          (prevHandshakeAt === null || statHandshakeAt >= prevHandshakeAt));
      const prevTs = prev ? Date.parse(prev.ts) : at;

      // Простаивающая реплика или тик старше снимка: снимок не трогаем.
      if (
        prev &&
        ((!fromThisNode && !deltas[index].rx && !deltas[index].tx) ||
          at < prevTs)
      ) {
        lives.push(prev);

        return;
      }

      const lastHandshakeAt = fromThisNode ? statHandshakeAt : prevHandshakeAt;
      const live: IWgPeerLive = {
        peerId: peer.id,
        interfaceId: iface.id,
        nodeId: fromThisNode ? node.id : prev!.nodeId,
        userId: peer.userId,
        createdById: peer.createdById,
        online: isPeerOnline(lastHandshakeAt, at),
        lastHandshakeAt: lastHandshakeAt?.toISOString() ?? null,
        endpoint: fromThisNode ? stat.endpoint : prev!.endpoint,
        rxTotal,
        txTotal,
        rxBps: prev ? speedBps(prev.rxTotal, rxTotal, at - prevTs) : 0,
        txBps: prev ? speedBps(prev.txTotal, txTotal, at - prevTs) : 0,
        ts: new Date(at).toISOString(),
      };

      lives.push(live);
      liveWrites.push([`peer:${peer.id}`, live]);
      if (fresh) {
        windowWrites.push([`win:peer:${peer.id}`, point(live)]);
        if (
          this._shouldEmit(
            `peer:${peer.id}`,
            live.rxBps,
            live.txBps,
            live.online,
            at,
            everyTick,
          )
        ) {
          emitted.push(live);
        }
      }

      const history = this._historyStep(peer, live, lastWrites[index], at);

      lastWriteUpdates.push([`lw:peer:${peer.id}`, history.lastWrite]);
      if (history.sample) {
        sampleRows.push(history.sample);
        peerUpdates.push({
          peerId: peer.id,
          lastHandshakeAt: lastHandshakeAt,
          lastEndpoint: live.endpoint,
          rxBytesTotal: live.rxTotal,
          txBytesTotal: live.txTotal,
        });
      }
    });

    await this._live.setJsonMany(
      matches.map(({ peer, stat }) => [
        `raw:${peer.id}:${node.id}`,
        { rx: stat.rxBytes, tx: stat.txBytes },
      ]),
      COUNTER_TTL_SEC,
    );
    await this._live.setJsonMany(liveWrites, LIVE_TTL_SEC);
    await this._live.setJsonMany(lastWriteUpdates, COUNTER_TTL_SEC);
    await this._live.pushCapped(
      windowWrites,
      WG_SPEED_WINDOW_POINTS,
      WINDOW_TTL_SEC,
    );
    if (sampleRows.length > 0) await this._samples.insert(sampleRows);
    if (peerUpdates.length > 0) {
      await this._peerService.applyStatsUpdates(peerUpdates);
    }
    if (emitted.length > 0) {
      this._eventBus.emit(new WgPeersLiveStatsEvent(node.id, emitted));
    }

    return lives;
  }

  /**
   * Шаг истории пира: пики копятся между записями; запись — раз в минуту и при
   * смене онлайна, с приращением трафика с прошлой записи.
   */
  private _historyStep(
    peer: WgPeer,
    live: IWgPeerLive,
    lastWrite: ILastWrite | null,
    at: number,
  ): { lastWrite: ILastWrite; sample: Partial<WgStatSample> | null } {
    const peak: ILastWrite = lastWrite ?? {
      ts: 0,
      rxTotal: peer.rxBytesTotal,
      txTotal: peer.txBytesTotal,
      rxPeakBps: 0,
      txPeakBps: 0,
      online: live.online,
    };
    const due =
      !lastWrite ||
      at - lastWrite.ts >= WG_DB_WRITE_INTERVAL_MS ||
      lastWrite.online !== live.online;
    const rxPeakBps = Math.max(peak.rxPeakBps, live.rxBps);
    const txPeakBps = Math.max(peak.txPeakBps, live.txBps);

    if (!due) {
      return { lastWrite: { ...peak, rxPeakBps, txPeakBps }, sample: null };
    }

    return {
      lastWrite: {
        ts: at,
        rxTotal: live.rxTotal,
        txTotal: live.txTotal,
        rxPeakBps: 0,
        txPeakBps: 0,
        online: live.online,
      },
      sample: {
        peerId: peer.id,
        interfaceId: live.interfaceId,
        nodeId: live.nodeId,
        userId: peer.userId,
        ts: new Date(at),
        rxTotal: live.rxTotal,
        txTotal: live.txTotal,
        rxDelta: Math.max(0, live.rxTotal - peak.rxTotal),
        txDelta: Math.max(0, live.txTotal - peak.txTotal),
        rxPeakBps,
        txPeakBps,
        online: live.online,
      },
    };
  }

  private async _ingestInterfaces(
    node: WgNode,
    interfaces: WgInterface[],
    peerLives: IWgPeerLive[],
    at: number,
    fresh: boolean,
    everyTick: boolean,
  ): Promise<IWgInterfaceLive[]> {
    const lives = interfaces.map((iface): IWgInterfaceLive => {
      const peers = peerLives.filter(peer => peer.interfaceId === iface.id);

      return {
        interfaceId: iface.id,
        nodeId: node.id,
        name: iface.name,
        peersTotal: peers.length,
        peersOnline: peers.filter(peer => peer.online).length,
        rxTotal: sum(peers, peer => peer.rxTotal),
        txTotal: sum(peers, peer => peer.txTotal),
        rxBps: sum(peers, peer => peer.rxBps),
        txBps: sum(peers, peer => peer.txBps),
        ts: new Date(at).toISOString(),
      };
    });

    await this._live.setJsonMany(
      lives.map(live => [`iface:${live.interfaceId}`, live]),
      LIVE_TTL_SEC,
    );
    if (!fresh) return lives;

    await this._live.pushCapped(
      lives.map(live => [`win:iface:${live.interfaceId}`, point(live)]),
      WG_SPEED_WINDOW_POINTS,
      WINDOW_TTL_SEC,
    );
    for (const live of lives) {
      if (
        this._shouldEmit(
          `iface:${live.interfaceId}`,
          live.rxBps,
          live.txBps,
          live.peersOnline > 0,
          at,
          everyTick,
        )
      ) {
        this._eventBus.emit(new WgInterfaceLiveStatsEvent(live));
      }
    }

    return lives;
  }

  private async _ingestNode(
    node: WgNode,
    interfaceLives: IWgInterfaceLive[],
    sys: IWgNodeSysMetrics | null,
    transport: EWgAgentTransport | null,
    at: number,
    fresh: boolean,
    everyTick: boolean,
  ): Promise<void> {
    const live: IWgNodeLive = {
      nodeId: node.id,
      interfacesTotal: interfaceLives.length,
      peersTotal: sum(interfaceLives, iface => iface.peersTotal),
      peersOnline: sum(interfaceLives, iface => iface.peersOnline),
      rxTotal: sum(interfaceLives, iface => iface.rxTotal),
      txTotal: sum(interfaceLives, iface => iface.txTotal),
      rxBps: sum(interfaceLives, iface => iface.rxBps),
      txBps: sum(interfaceLives, iface => iface.txBps),
      sys,
      transport,
      ts: new Date(at).toISOString(),
    };

    if (fresh) {
      await this._live.setJson(`node:${node.id}`, live, LIVE_TTL_SEC);
      await this._live.registerNode(node.id);
      await this._live.pushCapped(
        [[`win:node:${node.id}`, point(live)]],
        WG_SPEED_WINDOW_POINTS,
        WINDOW_TTL_SEC,
      );
      if (
        this._shouldEmit(
          `node:${node.id}`,
          live.rxBps,
          live.txBps,
          live.peersOnline > 0,
          at,
          everyTick,
        )
      ) {
        this._eventBus.emit(new WgNodeLiveStatsEvent(live));
      }
    }

    if (sys) await this._maybeWriteNodeMetric(node.id, sys, at);
  }

  private async _maybeWriteNodeMetric(
    nodeId: string,
    sys: IWgNodeSysMetrics,
    at: number,
  ): Promise<void> {
    const key = `lw:node:${nodeId}`;
    const lastWrite = await this._live.getJson<{ ts: number }>(key);

    if (lastWrite && at - lastWrite.ts < WG_DB_WRITE_INTERVAL_MS) return;

    await this._metrics.createAndSave({
      nodeId,
      ts: new Date(at),
      cpuPercent: sys.cpuPercent,
      load1: sys.load1,
      memUsedBytes: sys.memUsedBytes,
      memTotalBytes: sys.memTotalBytes,
      diskUsedBytes: sys.diskUsedBytes,
      diskTotalBytes: sys.diskTotalBytes,
      uptimeSec: sys.uptimeSec,
    });
    await this._live.setJson(key, { ts: at }, COUNTER_TTL_SEC);
  }

  /** Сводка по всем нодам — не чаще раза в секунду на процесс. */
  private async _maybeRebuildOverview(
    now: number,
    everyTick: boolean,
  ): Promise<void> {
    if (now - this._overviewAt < OVERVIEW_MIN_INTERVAL_MS) return;
    this._overviewAt = now;

    try {
      const overview = await this._overview.rebuildLiveOverview();

      if (
        this._shouldEmit(
          "overview",
          overview.rxBps,
          overview.txBps,
          true,
          now,
          everyTick,
        )
      ) {
        this._eventBus.emit(new WgOverviewUpdatedEvent(overview));
      }
    } catch (err) {
      logger.warn({ err }, "[WG] overview rebuild failed");
    }
  }

  /**
   * Нужно ли событие: при спросе — всегда; иначе — при заметном изменении
   * скорости, смене онлайна или после тишины.
   */
  private _shouldEmit(
    key: string,
    rxBps: number,
    txBps: number,
    online: boolean,
    now: number,
    everyTick: boolean,
  ): boolean {
    const last = this._lastEmits.get(key);
    const changed =
      everyTick ||
      !last ||
      last.online !== online ||
      Math.abs(last.rxBps - rxBps) > WG_LIVE_EMIT_DEADBAND_BPS ||
      Math.abs(last.txBps - txBps) > WG_LIVE_EMIT_DEADBAND_BPS ||
      now - last.ts >= WG_LIVE_EMIT_MAX_SILENCE_MS;

    if (!changed) return false;

    this._lastEmits.set(key, { ts: now, rxBps, txBps, online });
    if (this._lastEmits.size > 50_000) this._lastEmits.clear();

    return true;
  }

  /**
   * Карта интерфейсов и пиров ноды: любое изменение пиров и интерфейсов
   * поднимает версию конфигурации ноды — по ней карта и обновляется.
   */
  private async _peerMap(node: WgNode): Promise<IPeerMapCache> {
    const cached = this._peerMaps.get(node.id);

    if (
      cached &&
      cached.version === node.configVersion &&
      cached.expiresAt > Date.now()
    ) {
      return cached;
    }

    const interfaces = await this._interfaces.findForNode(node.id);
    const peers =
      interfaces.length > 0
        ? await this._peers.find({
            where: interfaces.map(iface => ({ interfaceId: iface.id })),
          })
        : [];
    const map: IPeerMapCache = {
      version: node.configVersion,
      expiresAt: Date.now() + PEER_MAP_TTL_MS,
      interfacesByName: new Map(interfaces.map(iface => [iface.name, iface])),
      peersByKey: new Map(
        peers.map(peer => [`${peer.interfaceId}:${peer.publicKey}`, peer]),
      ),
    };

    this._peerMaps.set(node.id, map);

    return map;
  }
}
