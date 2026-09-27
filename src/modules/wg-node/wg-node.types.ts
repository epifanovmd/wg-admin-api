/** Статус ноды: online/offline — живость агента, provisioning — идёт установка. */
export enum EWgNodeStatus {
  Created = "created",
  Provisioning = "provisioning",
  Online = "online",
  Offline = "offline",
  Error = "error",
}

/** Типы команд, исполняемых агентом на ноде. */
export enum EWgNodeCommandType {
  /** Перезапуск интерфейса `wg-quick down && up`. */
  InterfaceRestart = "interface-restart",
  /** Последние строки журнала агента. */
  AgentLogs = "agent-logs",
  /** Обновить код агента с бэкенда и перезапуститься. */
  AgentUpdate = "agent-update",
}

export enum EWgNodeCommandStatus {
  Pending = "pending",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Timeout = "timeout",
}

/** Сведения об ОС ноды, которые сообщает агент. */
/**
 * Реализация WireGuard на ноде. `userspace` (wireguard-go) живёт в процессе
 * агента: перезапуск контейнера агента роняет интерфейсы.
 */
export enum EWgMode {
  Kernel = "kernel",
  Userspace = "userspace",
}

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

/** Полезная нагрузка команды агенту. */
export interface IWgNodeCommandPayload {
  /** interface-restart: имя интерфейса. */
  interfaceName?: string;
  /** agent-logs: сколько последних строк вернуть. */
  lines?: number;
  /** agent-update: sha256 бинаря, который агент должен установить. */
  hash?: string;
}

export const WG_NODE_NAME_MAX = 120;
export const WG_NODE_DESCRIPTION_MAX = 2000;
export const WG_NODE_HOST_MAX = 255;
export const WG_AGENT_LOGS_DEFAULT_LINES = 200;
export const WG_AGENT_LOGS_MAX_LINES = 1000;

/** Домен scope агентского api-ключа: `wg-agent:<nodeId>`. */
export const WG_AGENT_SCOPE_DOMAIN = "wg-agent";

export const wgAgentScope = (nodeId: string): string =>
  `${WG_AGENT_SCOPE_DOMAIN}:${nodeId}`;

/** nodeId из scopes агентского ключа; ключ не агентский — `null`. */
export const nodeIdFromScopes = (scopes: string[]): string | null => {
  const prefix = `${WG_AGENT_SCOPE_DOMAIN}:`;
  const scope = scopes.find(item => item.startsWith(prefix));

  return scope ? scope.slice(prefix.length) : null;
};
