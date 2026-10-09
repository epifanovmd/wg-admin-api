/** Статус ноды: online/offline — живость агента, provisioning — идёт установка. */
export enum EWgNodeStatus {
  Created = "created",
  Provisioning = "provisioning",
  Online = "online",
  Offline = "offline",
  Error = "error",
}

/** Реализация WireGuard на ноде: модуль ядра или wireguard-go. */
export enum EWgMode {
  Kernel = "kernel",
  Userspace = "userspace",
}

/** Сведения об ОС ноды: от агента (узел) и воркера wg (режим, порты). */
export interface IWgNodeOsInfo {
  platform?: string;
  release?: string;
  distro?: string;
  arch?: string;
  hostname?: string;
  kernel?: string;
  /** Реализация WireGuard: модуль ядра или wireguard-go. */
  wgMode?: EWgMode;
  /** Занятые UDP-порты хоста. */
  udpPorts?: number[];
  /** Слушающие TCP-порты хоста. */
  tcpPorts?: number[];
}

export const WG_NODE_NAME_MAX = 120;
export const WG_NODE_DESCRIPTION_MAX = 2000;
export const WG_NODE_HOST_MAX = 255;
export const WG_AGENT_LOGS_DEFAULT_LINES = 200;
export const WG_AGENT_LOGS_MAX_LINES = 5000;

/** Метка агента, по которой он привязывается к ноде (токен установки). */
export const WG_NODE_ID_LABEL = "nodeId";

/** Воркер WireGuard на агенте ноды: интерфейсы, туннели, пробросы, пробы. */
export const WG_WORKER = "wg";

/** Воркер SOCKS5-прокси на агенте ноды. */
export const SOCKS_WORKER = "socks";

/** Воркеры агента ноды — ставятся из выпуска при установке. */
export const WG_NODE_WORKERS = [WG_WORKER, SOCKS_WORKER] as const;

/** Ключи настроек воркеров: желаемое состояние, цели проб, прокси. */
export const WG_STATE_CONFIG = "state";
export const WG_PROBES_CONFIG = "probes";
export const SOCKS_PROXIES_CONFIG = "proxies";

/** Срок токена установки агента вручную, минут. */
export const WG_NODE_INSTALL_TOKEN_TTL_MINUTES = 24 * 60;

/** Длина id агента (SDK выдаёт 32 шестнадцатеричных символа). */
export const WG_NODE_AGENT_ID_MAX = 64;
