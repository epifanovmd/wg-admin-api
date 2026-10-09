/**
 * Контракт воркеров агента ноды (`agent/workers/wg`, `agent/workers/socks`):
 * значения настроек, итоги их применения, метрики и события. Формат связи с
 * агентом — agent-sdk; здесь — только то, что понимают воркеры проекта
 * (их манифест — `GET /manifest`). Менять вместе с воркерами.
 */
import type { EWgForwardActiveRoute, EWgForwardRoute } from "../wg-forward";
import type { IWgSocksAgentConfig } from "../wg-socks";
import type { IWgNodeProbe, IWgProbeTarget, IWgTunnelProbe } from "../wg-stats";

/** Пир в серверном конфиге интерфейса. */
export interface IWgWorkerPeer {
  publicKey: string;
  presharedKey: string | null;
  allowedIps: string;
}

/** Желаемое состояние интерфейса на ноде. */
export interface IWgWorkerInterface {
  name: string;
  enabled: boolean;
  listenPort: number;
  addressCidr: string;
  addressV6Cidr: string | null;
  privateKey: string;
  mtu: number | null;
  /** Пресет NAT (masquerade через egress-интерфейс ноды). */
  natEnabled: boolean;
  customPostUp: string | null;
  customPostDown: string | null;
  peers: IWgWorkerPeer[];
}

/** IPIP-туннель (конец на этой ноде). */
export interface IWgWorkerTunnel {
  name: string;
  remoteHost: string;
  localTunnelIp: string;
  remoteTunnelIp: string;
  prefix: number;
  mtu: number;
}

/** Проброс порта на релее; маршрут выбирает воркер по здоровью туннеля. */
export interface IWgWorkerForward {
  /** id проброса wg-forward или интерфейса точки — для отчёта о маршруте. */
  id?: string;
  proto: "udp" | "tcp";
  listenPort: number;
  targetIp: string;
  targetPort: number;
  /** Прямой адрес цели для аварийного пути мимо туннеля. */
  fallbackIp?: string | null;
  route?: EWgForwardRoute;
  /** Туннель, по здоровью которого выбирается маршрут. */
  tunnel?: string | null;
  /** Копии интерфейса (реплики) по приоритету — берётся первая живая. */
  candidates?: Array<{
    targetIp: string;
    tunnel: string | null;
    nodeId: string;
  }>;
}

/** Настройка `state` воркера wg — полное желаемое состояние ноды. */
export interface IWgStateConfig {
  /** Версия конфигурации ноды (`wg_nodes.config_version`). */
  version: number;
  nodeId: string;
  nodeName: string;
  interfaces: IWgWorkerInterface[];
  tunnels: IWgWorkerTunnel[];
  forwards: IWgWorkerForward[];
}

/** Настройка `probes` воркера wg — ноды для проверки связности. */
export interface IWgProbesConfig {
  targets: IWgProbeTarget[];
}

/** Статус интерфейса после применения. */
export interface IWgWorkerInterfaceStatus {
  name: string;
  status: "up" | "down" | "error" | "unknown";
  message?: string | null;
}

/** Активный маршрут проброса релея. */
export interface IWgForwardRouteReport {
  id: string;
  activeRoute: EWgForwardActiveRoute;
  activeCandidate?: number;
  /** Копия интерфейса, обслуживающая трафик (для пробросов точек). */
  activeNodeId?: string;
}

/**
 * Итог применения `state` (тело ответа на `PUT /config/state` и событие
 * `state.result` после повтора): ошибки частей не прерывают остальное.
 */
export interface IWgStateResult {
  version: number;
  appliedAt?: number;
  interfaces: IWgWorkerInterfaceStatus[];
  routes?: IWgForwardRouteReport[];
  errors?: string[];
}

/** Счётчики пира из `wg show dump`. */
export interface IWgWorkerPeerStat {
  publicKey: string;
  rxBytes: number;
  txBytes: number;
  /** Unix-время последнего рукопожатия, с; `null`/0 — не было. */
  lastHandshake: number | null;
  endpoint: string | null;
}

/** Ответ `GET /metrics` воркера wg. */
export interface IWgWorkerMetrics {
  interfaces?: Array<{ name: string; peers: IWgWorkerPeerStat[] }>;
  tunnels?: IWgTunnelProbe[];
  forwards?: IWgForwardRouteReport[];
  nodeProbes?: IWgNodeProbe[];
}

/** Событие `route.changed`: маршруты пробросов сменились по пробам. */
export interface IWgRouteChangedEvent {
  version?: number;
  routes: IWgForwardRouteReport[];
}

/** Настройка `proxies` воркера socks. */
export interface ISocksProxiesConfig {
  proxies: IWgSocksAgentConfig[];
}

/** Ответ `GET /metrics` воркера socks. */
export interface ISocksWorkerMetrics {
  proxies?: Array<{
    id: string;
    connections: number;
    rxBytes: number;
    txBytes: number;
  }>;
}

/** События воркера wg. */
export const WG_EVENT_STATE_RESULT = "state.result";
export const WG_EVENT_ROUTE_CHANGED = "route.changed";

/** MTU IPIP-туннеля: 1500 − 20 байт заголовка IPIP. */
export const WG_TUNNEL_MTU = 1480;
