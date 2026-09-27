/**
 * Контракт протокола агента. Копия типов живёт в `agent/src/protocol.ts` —
 * менять синхронно (агент обновляется вместе с бэкендом).
 */
import type { EWgForwardActiveRoute, EWgForwardRoute } from "../wg-forward";
import type {
  EWgMode,
  EWgNodeCommandType,
  IWgNodeCommandPayload,
} from "../wg-node";
import type { IWgSocksAgentConfig } from "../wg-socks";
import type {
  IWgNodeProbe,
  IWgNodeSysMetrics,
  IWgProbeTarget,
  IWgTunnelProbe,
} from "../wg-stats";

/** Пир в серверном конфиге интерфейса. */
export interface IWgAgentPeer {
  publicKey: string;
  presharedKey: string | null;
  allowedIps: string;
}

/** Желаемое состояние интерфейса на ноде. */
export interface IWgAgentInterface {
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
  peers: IWgAgentPeer[];
}

/** IPIP-туннель (конец на этой ноде). */
export interface IWgAgentTunnel {
  name: string;
  remoteHost: string;
  localTunnelIp: string;
  remoteTunnelIp: string;
  prefix: number;
  mtu: number;
}

/** Проброс UDP на релей-ноде. */
/** Проброс на релее (см. агент: failover.ts). */
export interface IWgAgentForward {
  /** id проброса wg-forward — для отчёта о маршруте; у точек подключения нет. */
  id?: string;
  proto: "udp" | "tcp";
  listenPort: number;
  targetIp: string;
  targetPort: number;
  /** Прямой адрес цели для аварийного пути мимо туннеля. */
  fallbackIp?: string | null;
  route?: EWgForwardRoute;
  /** Туннель, по здоровью которого агент выбирает маршрут. */
  tunnel?: string | null;
  /** Копии интерфейса (реплики) по приоритету — агент берёт первую живую. */
  candidates?: Array<{
    targetIp: string;
    tunnel: string | null;
    nodeId: string;
  }>;
}

/** Императивная команда агенту. */
export interface IWgAgentCommand {
  id: string;
  type: EWgNodeCommandType;
  payload: IWgNodeCommandPayload;
  /** Срок выполнения: дольше команда считается просроченной (timeout). */
  timeoutSec: number;
}

/** Полное желаемое состояние ноды. */
export interface IWgAgentDesiredState {
  version: number;
  nodeId: string;
  nodeName: string;
  interfaces: IWgAgentInterface[];
  tunnels: IWgAgentTunnel[];
  forwards: IWgAgentForward[];
  /** Ноды для проверки связности (не версионируются: берутся из любого ответа). */
  probeTargets: IWgProbeTarget[];
  /** SOCKS5-прокси через mTLS на ноде. */
  socks: IWgSocksAgentConfig[];
  commands: IWgAgentCommand[];
  settings: {
    /** Период отправки статистики агентом. */
    statsIntervalMs: number;
  };
}

/** Статус интерфейса в отчёте агента. */
export interface IWgAgentInterfaceStatusReport {
  name: string;
  status: "up" | "down" | "error" | "unknown";
  message?: string | null;
}

/** Отчёт агента о применении конфигурации и системе. */
export interface IWgAgentReportBody {
  appliedVersion?: number;
  applyError?: string | null;
  agentVersion?: string;
  wgVersion?: string | null;
  /** sha256 бинаря агента. */
  codeHash?: string | null;
  os?: {
    platform?: string;
    release?: string;
    distro?: string;
    arch?: string;
    hostname?: string;
    kernel?: string;
    wgMode?: EWgMode;
    udpPorts?: number[];
    tcpPorts?: number[];
  };
  interfaces?: IWgAgentInterfaceStatusReport[];
}

/**
 * Статистика от агента (см. wg-stats). Поля тика необязательны: без них
 * момент сбора — время приёма, повторы не распознаются.
 */
export interface IWgAgentStatsBody {
  /** Номер тика в рамках запуска агента: повтор с тем же номером отбрасывается. */
  seq?: number;
  /** Идентификатор запуска агента: при перезапуске нумерация начинается заново. */
  bootId?: string;
  /** Момент сбора по часам агента (unix ms). */
  collectedAt?: number;
  /** Момент отправки по часам агента (unix ms): задержка доставки — `sentAt − collectedAt`. */
  sentAt?: number;
  sys?: IWgNodeSysMetrics;
  /** Пробы IPIP-туннелей ноды. */
  tunnels?: IWgTunnelProbe[];
  /** Активные маршруты пробросов релея. */
  forwards?: Array<{
    id: string;
    activeRoute: EWgForwardActiveRoute;
    /** Копия интерфейса, обслуживающая трафик (для пробросов точек). */
    activeNodeId?: string;
  }>;
  /** Подключения и трафик прокси ноды. */
  socks?: Array<{
    id: string;
    connections: number;
    rxBytes: number;
    txBytes: number;
  }>;
  /** Пробы других нод (раз в ~60 с). */
  nodeProbes?: IWgNodeProbe[];
  interfaces: Array<{
    name: string;
    peers: Array<{
      publicKey: string;
      rxBytes: number;
      txBytes: number;
      lastHandshake: number | null;
      endpoint: string | null;
    }>;
  }>;
}

export interface IWgAgentCommandOutputBody {
  chunk: string;
}

export interface IWgAgentCommandCompleteBody {
  exitCode?: number | null;
  error?: string | null;
}

/** MTU IPIP-туннеля: 1500 − 20 байт заголовка IPIP. */
export const WG_AGENT_TUNNEL_MTU = 1480;
/** Период статистики агента по умолчанию. */
export const WG_AGENT_STATS_INTERVAL_MS = 2000;
