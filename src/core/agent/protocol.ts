/**
 * Типы протокола агента (github.com/epifanovmd/agent, docs/PROTOCOL.md): бэкенд ↔ агент —
 * HTTPS, вниз поток SSE (`desired`, `command`), вверх POST. Имена полей — как в JSON протокола.
 */

/** Маршруты бэкенда для агентов — под `AGENT_PROTOCOL_PREFIX`. */
export const AGENT_PROTOCOL_PREFIX = "/agent/v1";

/** Ошибка протокола: `{ code, message }`. */
export interface IAgentErrorInfo {
  code: string;
  message: string;
}

/** Коды ошибок протокола. */
export const AgentProtocolCode = {
  ENROLL_DENIED: "ENROLL_DENIED",
  AGENT_UNKNOWN: "AGENT_UNKNOWN",
  AGENT_REVOKED: "AGENT_REVOKED",
  MESSAGE_INVALID: "MESSAGE_INVALID",
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
  BUSY: "BUSY",
  WORKER_UNKNOWN: "WORKER_UNKNOWN",
  WORKER_UNAVAILABLE: "WORKER_UNAVAILABLE",
  COMMAND_UNDECLARED: "COMMAND_UNDECLARED",
  REQUEST_UNDECLARED: "REQUEST_UNDECLARED",
  CONFIG_REJECTED: "CONFIG_REJECTED",
  AGENT_OFFLINE: "AGENT_OFFLINE",
  UPDATE_FAILED: "UPDATE_FAILED",
  UPDATE_NOT_SUPPORTED: "UPDATE_NOT_SUPPORTED",
} as const;

export interface IAgentHost {
  os: string;
  arch: string;
  hostname: string;
  kernel?: string;
}

/** Тело `POST /agent/v1/enroll`. */
export interface IAgentEnroll {
  token: string;
  name: string;
  labels?: Record<string, string>;
  host: IAgentHost;
}

export interface IAgentManifestConfig {
  key: string;
  description?: string;
  schema?: unknown;
}

export interface IAgentManifestCommand {
  type: string;
  description?: string;
  schema?: unknown;
  result?: unknown;
}

export interface IAgentManifestEvent {
  type: string;
  description?: string;
  schema?: unknown;
}

export interface IAgentManifestRequest {
  type: string;
  description?: string;
  schema?: unknown;
  response?: unknown;
}

/** Что воркер умеет: ключи настроек, команды, события, запросы к бэкенду. */
export interface IAgentWorkerManifest {
  description?: string;
  configs?: IAgentManifestConfig[];
  commands?: IAgentManifestCommand[];
  events?: IAgentManifestEvent[];
  requests?: IAgentManifestRequest[];
}

export interface IAgentHelloWorker {
  name: string;
  version?: string;
  release?: boolean;
  manifest?: IAgentWorkerManifest;
}

/** Тело `POST /agent/v1/hello`. */
export interface IAgentHello {
  agent: {
    version: string;
    bootId: string;
    startedAt: number;
    updateMode: string;
    install?: string;
  };
  host: IAgentHost;
  name: string;
  labels?: Record<string, string>;
  workers: IAgentHelloWorker[];
}

/** Состояние агента (§4): ждёт подтверждения, работает, отозван. */
export type TAgentStatus = "pending" | "active" | "revoked";

export interface IAgentHelloReply {
  /** Состояние агента у бэкенда: `active` — работать; `pending` — ждать подтверждения. */
  status: TAgentStatus;
  serverTime: number;
  stateMs?: number;
  metricsMs?: number;
}

export interface IAgentConfigValue {
  version: number;
  data: unknown;
}

/** Наблюдение: метрики чаще, журнал подробнее, до `until` (мс). */
export interface IAgentWatch {
  metricsIntervalMs?: number;
  logLevel?: string;
  until?: number;
}

/** Желаемое состояние узла. */
export interface IAgentDesired {
  rev: number;
  workers: Record<string, { configs: Record<string, IAgentConfigValue> }>;
  watch: IAgentWatch | null;
}

/** Команда агенту. */
export interface IAgentCommand {
  seq: number;
  id: string;
  type: string;
  args?: unknown;
  deadline?: number;
}

/** Итог команды. */
export interface IAgentResult {
  re: string;
  ok: boolean;
  result?: unknown;
  error?: IAgentErrorInfo;
}

/** Событие воркера. */
export interface IAgentEvent {
  id: string;
  worker: string;
  type: string;
  data?: unknown;
  at: number;
}

/** Событие хода команды воркера: data — `IAgentProgress`. */
export const AGENT_EVENT_COMMAND_PROGRESS = "command.progress";

export interface IAgentProgress {
  re: string;
  worker?: string;
  progress: number;
  message?: string;
}

export interface IAgentAccepted {
  accepted: string[];
  rejected?: Array<{ id: string; reason: string }>;
}

export interface IAgentHealth {
  ok: boolean;
  busy?: boolean;
  message?: string;
}

export interface IAgentAppliedStatus {
  version: number;
  ok?: boolean;
  error?: IAgentErrorInfo;
}

export type TAgentWorkerState =
  "starting" | "running" | "invalid" | "backoff" | "stopped";

export interface IAgentWorkerState {
  name: string;
  state: TAgentWorkerState;
  message?: string;
  version?: string;
  release?: boolean;
  restarts: number;
  health?: IAgentHealth;
  pending?: "restart" | "update";
  configs?: Record<string, IAgentAppliedStatus>;
}

/** Тело `POST /agent/v1/state`. */
export interface IAgentState {
  desiredRev: number;
  outbox: number;
  update?: { latest: string; checkedAt: number };
  workers: IAgentWorkerState[];
}

/** Точка метрик: узел и метрики воркеров (из их пульса). */
export interface IAgentMetrics {
  at: number;
  host?: Record<string, unknown>;
  workers?: Record<string, unknown>;
}

export interface IAgentLogEntry {
  at: number;
  level: string;
  source: string;
  msg: string;
  attrs?: Record<string, unknown>;
}

/** Запрос воркера к бэкенду. */
export interface IAgentRequest {
  id?: string;
  worker?: string;
  type: string;
  data?: unknown;
  timeoutMs?: number;
}

export interface IAgentRequestReply {
  ok: boolean;
  data?: unknown;
  error?: IAgentErrorInfo;
}

/** Команды агенту. */
export const AgentCommandType = {
  WORKER_COMMAND: "worker.command",
  WORKER_CANCEL: "worker.cancel",
  WORKER_RESTART: "worker.restart",
  WORKER_UPDATE: "worker.update",
  AGENT_UPDATE: "agent.update",
  AGENT_ROTATE_KEY: "agent.rotateKey",
  AGENT_LOGS: "agent.logs",
} as const;

export type TAgentCommandType =
  (typeof AgentCommandType)[keyof typeof AgentCommandType];

export interface IAgentWorkerCommandArgs {
  worker: string;
  type: string;
  args?: unknown;
  timeoutMs?: number;
}

export interface IAgentWorkerUpdateArgs {
  worker: string;
  version: string;
  url: string;
  sha256: string;
  signature: string;
  force?: boolean;
}

/** Манифест каталога сборок (`agent manifest`). */
export interface IAgentReleaseManifest {
  version: string;
  publicKey?: string;
  artifacts: Array<{
    os: string;
    arch: string;
    file: string;
    sha256: string;
    signature?: string;
  }>;
  workers?: Array<{
    name: string;
    version: string;
    os: string;
    arch: string;
    file: string;
    sha256: string;
    signature?: string;
    stopTimeout?: string;
    command?: string;
  }>;
}

/** Сравнение версий `1.2.10` > `1.2.9`; предварительная (`-rc`) младше. */
export const compareAgentVersions = (a: string, b: string): number => {
  const parse = (v: string) => {
    const [core, pre = ""] = v.replace(/^v/, "").split("-", 2);

    return { parts: core.split(".").map(n => Number(n) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);

  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i += 1) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);

    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;

  return x.pre < y.pre ? -1 : 1;
};
