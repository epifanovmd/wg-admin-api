/** Системные метрики ноды из отчёта агента. */
/** Скорость сетевого интерфейса хоста. */
export interface IWgNicRate {
  name: string;
  rxBps: number;
  txBps: number;
}

export interface IWgNodeSysMetrics {
  cpuPercent: number;
  load1: number;
  load5?: number;
  load15?: number;
  /** Сетевые интерфейсы хоста без lo и Docker. */
  nics?: IWgNicRate[];
  conntrackCount?: number | null;
  conntrackMax?: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  uptimeSec: number;
}

/** Live-снимок пира. */
export interface IWgPeerLive {
  peerId: string;
  interfaceId: string;
  nodeId: string;
  userId: string | null;
  online: boolean;
  lastHandshakeAt: string | null;
  endpoint: string | null;
  rxTotal: number;
  txTotal: number;
  rxBps: number;
  txBps: number;
  ts: string;
}

/** Live-снимок интерфейса. */
export interface IWgInterfaceLive {
  interfaceId: string;
  nodeId: string;
  name: string;
  peersTotal: number;
  peersOnline: number;
  rxTotal: number;
  txTotal: number;
  rxBps: number;
  txBps: number;
  ts: string;
}

/** Live-снимок ноды. */
export interface IWgNodeLive {
  nodeId: string;
  interfacesTotal: number;
  peersTotal: number;
  peersOnline: number;
  rxTotal: number;
  txTotal: number;
  rxBps: number;
  txBps: number;
  sys: IWgNodeSysMetrics | null;
  /** Канал связи агента; `null` — неизвестен. */
  transport: EWgAgentTransport | null;
  ts: string;
}

/** Сводка для дашборда. */
export interface IWgOverview {
  nodes: { total: number; online: number };
  interfaces: { total: number; enabled: number };
  peers: { total: number; enabled: number; online: number };
  rxTotal: number;
  txTotal: number;
  rxBps: number;
  txBps: number;
  ts: string;
}

/** Группировка серий статистики. */
export enum EWgSeriesGroupBy {
  Total = "total",
  Node = "node",
  Interface = "interface",
  Peer = "peer",
}

/** Канал связи агента с бэкендом. */
export enum EWgAgentTransport {
  /** Постоянное WebSocket-соединение. */
  Link = "link",
  /** Запасной путь: long-poll и отдельные HTTP-запросы. */
  Http = "http",
}

/** Точка короткой истории скорости (кольцевой ряд последних минут). */
export interface IWgSpeedPoint {
  /** Момент сбора (unix ms). */
  ts: number;
  rxBps: number;
  txBps: number;
}

/** Точек в коротком ряду: 10 минут при тике в 1 с. */
export const WG_SPEED_WINDOW_POINTS = 600;

/** Порог изменения скорости для live-события (Б/с). */
export const WG_LIVE_EMIT_DEADBAND_BPS = 256;
/** Максимальная тишина между live-событиями пира. */
export const WG_LIVE_EMIT_MAX_SILENCE_MS = 30_000;
/** Период записи истории в БД. */
export const WG_DB_WRITE_INTERVAL_MS = 60_000;
/** Шаг серии по умолчанию и пределы. */
export const WG_SERIES_MIN_STEP_SEC = 60;
export const WG_SERIES_MAX_POINTS = 1000;
/** Диапазон, начиная с которого серии читаются из часовых агрегатов. */
export const WG_SERIES_HOURS_THRESHOLD_MS = 48 * 3600 * 1000;

/** Проба IPIP-туннеля агентом. */
export interface IWgTunnelProbe {
  name: string;
  rttMs: number | null;
  lossPercent: number;
}

/** Роль ноды в линке релея. */
export enum EWgLinkRole {
  Relay = "relay",
  Target = "target",
}

/** Состояние линка: `unknown` — нет свежей пробы. */
export enum EWgLinkStatus {
  Ok = "ok",
  Degraded = "degraded",
  Down = "down",
  Unknown = "unknown",
}

/** Здоровье IPIP-линка релея глазами ноды. */
export interface IWgLinkHealth {
  linkId: string;
  role: EWgLinkRole;
  counterpartNodeId: string;
  counterpartName: string | null;
  tunnelName: string;
  rttMs: number | null;
  lossPercent: number | null;
  status: EWgLinkStatus;
  ts: string | null;
}

/** Нода, которую агент должен пинговать. */
export interface IWgProbeTarget {
  nodeId: string;
  host: string;
}

/** Проба другой ноды агентом. */
export interface IWgNodeProbe {
  nodeId: string;
  rttMs: number | null;
  lossPercent: number;
}

/** Измерение «откуда → куда». */
export interface IWgMeshCell {
  fromNodeId: string;
  toNodeId: string;
  rttMs: number | null;
  lossPercent: number;
  ts: string;
}

/** Матрица связности нод. */
export interface IWgMeshMatrix {
  nodes: Array<{ id: string; name: string }>;
  cells: IWgMeshCell[];
}
