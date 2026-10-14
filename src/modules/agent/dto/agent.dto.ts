import type {
  Agent,
  AgentCommand,
  AgentEnrollmentToken,
  AgentEvent,
  AgentMetric,
  IAgentConfigStatus,
  IAgentLogEntry,
  IAgentWorkerView,
} from "../../../core";

/**
 * Id агента в пути: формат проверяется до контроллера.
 * @pattern ^[0-9a-f]{32}$ Некорректный id агента
 */
export type TAgentId = string;

/**
 * Имя воркера или ключа настроек в пути.
 * @pattern ^[a-z][a-z0-9-]{0,31}$ Некорректное имя воркера или ключа
 */
export type TAgentWorkerName = string;

/** Ошибка `{ code, message }` агента или воркера. */
export interface IAgentErrorDto {
  code: string;
  message: string;
}

export interface IAgentHostDto {
  os: string;
  arch: string;
  hostname: string;
  kernel?: string;
}

/** Пульс воркера. */
export interface IAgentWorkerHealthDto {
  ok: boolean;
  /** Идёт работа, которую нельзя прерывать: плановая замена ждёт её окончания. */
  busy?: boolean;
  message?: string;
}

export interface IAgentManifestConfigDto {
  key: string;
  description?: string;
  /** JSON Schema значения. */
  schema?: Record<string, any>;
}

export interface IAgentManifestCommandDto {
  type: string;
  description?: string;
  /** JSON Schema аргументов. */
  schema?: Record<string, any>;
  /** JSON Schema итога. */
  result?: Record<string, any>;
}

export interface IAgentManifestEventDto {
  type: string;
  description?: string;
  schema?: Record<string, any>;
}

export interface IAgentManifestRequestDto {
  type: string;
  description?: string;
  schema?: Record<string, any>;
  response?: Record<string, any>;
}

/** Что воркер умеет (его регистрация на агенте). */
export interface IAgentWorkerManifestDto {
  description?: string;
  configs?: IAgentManifestConfigDto[];
  commands?: IAgentManifestCommandDto[];
  events?: IAgentManifestEventDto[];
  requests?: IAgentManifestRequestDto[];
}

/** Воркер агента. */
export interface IAgentWorkerDto {
  name: string;
  version?: string;
  /** Воркер со сборкой с сервера (обновляется `worker.update`). */
  release: boolean;
  state: "starting" | "running" | "invalid" | "backoff" | "stopped" | "unknown";
  message?: string;
  restarts: number;
  health?: IAgentWorkerHealthDto;
  /** Плановая замена ждёт, пока воркер занят. */
  pending?: "restart" | "update";
  manifest?: IAgentWorkerManifestDto;
  /** Версия в каталоге сборок новее работающей. */
  updateAvailable?: string;
}

/** Проблема агента. */
export interface IAgentAlertDto {
  kind:
    | "offline"
    | "workerDown"
    | "workerInvalid"
    | "workerUnhealthy"
    | "configFailed";
  worker?: string;
  key?: string;
  message: string;
}

/** Точка метрик: узел и метрики воркеров из их пульса. */
export interface IAgentMetricsPointDto {
  at: number;
  host?: Record<string, any>;
  workers?: Record<string, any>;
}

/** Агент. */
export interface AgentDto {
  id: string;
  name: string;
  labels: Record<string, string>;
  online: boolean;
  revoked: boolean;
  version?: string;
  /** self | external | disabled. */
  updateMode?: string;
  /** Как поставлен: systemd | user | manual. */
  install?: string;
  host?: IAgentHostDto;
  remoteIp?: string;
  /** Отметки времени, мс: регистрация, последняя связь, запуск программы агента. */
  enrolledAt: number;
  lastSeenAt?: number;
  startedAt?: number;
  /** Новая версия агента в его каталоге сборок. */
  updateAvailable?: string;
  /** Номер желаемого и применённый агентом. */
  desiredRev: number;
  appliedRev?: number;
  /** Итоги и события, ждущие отправки на узле. */
  outbox?: number;
  workers: IAgentWorkerDto[];
  metrics?: IAgentMetricsPointDto;
  alerts: IAgentAlertDto[];
}

/** Ключ настроек воркера и итог его применения. */
export interface AgentConfigDto {
  agentId: string;
  worker: string;
  key: string;
  version: number;
  /** `pending` — воркер ещё не применил эту версию. */
  state: "pending" | "applied" | "failed";
  error?: IAgentErrorDto;
  /** Значение — только с правом на настройки. */
  data?: any;
  /** Ключ удалён (только в событии сокета `agent:config`). */
  deleted?: boolean;
  /** Изменён, мс. */
  updatedAt: number;
  actor?: string;
}

/** Команда агенту и её итог. */
export interface AgentCommandDto {
  id: string;
  agentId: string;
  type: string;
  /** Для команды воркеру — воркер и тип его команды. */
  worker?: string;
  workerType?: string;
  args?: any;
  status: "pending" | "done";
  ok?: boolean;
  result?: any;
  error?: IAgentErrorDto;
  /** Ход долгой команды, 0..1. */
  progress?: number;
  progressText?: string;
  actor?: string;
  /** Поставлена и завершена, мс. */
  createdAt: number;
  finishedAt?: number;
}

/** Событие воркера. */
export interface IAgentEventDto {
  agentId: string;
  id: string;
  worker: string;
  type: string;
  data?: any;
  /** Замечания проверки `data` по схеме события из манифеста воркера. */
  problems?: string[];
  /** Время на узле и приёма, мс. */
  at: number;
  receivedAt: number;
}

export interface IAgentLogEntryDto {
  at: number;
  level: string;
  /** `agent` или имя воркера. */
  source: string;
  msg: string;
  attrs?: Record<string, any>;
}

export interface IAgentLogsDto {
  entries: IAgentLogEntryDto[];
}

export interface AgentEnrollmentTokenDto {
  id: string;
  name: string;
  /** Начало токена — для узнавания в списке. */
  prefix: string;
  labels: Record<string, string>;
  maxUses?: number;
  uses: number;
  expiresAt?: Date;
  revokedAt?: Date;
  createdBy?: string;
  createdAt: Date;
}

/** Созданный токен: полный токен — только в этом ответе. */
export interface ICreatedAgentEnrollmentTokenDto {
  token: string;
  enrollmentToken: AgentEnrollmentTokenDto;
}

export interface IAgentInstallCommandDto {
  command: string;
}

/** Архив агента для узлов (все платформы). */
export interface IAgentArchiveDto {
  file: string;
  version?: string;
  /** Платформы: `linux/amd64`, `linux/arm64`. */
  platforms: string[];
  size: number;
  /** В архиве есть compose.yml: запуск в Docker Compose. */
  compose: boolean;
}

/** Что можно выдать: адрес бэкенда для агентов и архив агента (нет — `AGENT_BUNDLE_DIR` пуст). */
export interface IAgentInstallOptionsDto {
  server: string;
  archive?: IAgentArchiveDto;
}

/** Выданный токен регистрации и `.env` с ним (показывается один раз). */
export interface IAgentIssuedEnvDto {
  env: string;
  token: string;
  tokenId: string;
  /** Срок токена, мс. */
  expiresAt: number;
}

/** Одноразовая ссылка на архив агента с токеном. */
export interface IAgentIssuedLinkDto {
  url: string;
  /** Срок ссылки, мс. */
  expiresAt: number;
}

/** Сборка воркера в каталоге сборок проекта. */
export interface IAgentWorkerBuildDto {
  name: string;
  version: string;
  os: string;
  arch: string;
}

export interface IAgentReleaseDto {
  /** Каталог архивов для узлов задан (`AGENT_BUNDLE_DIR`). */
  bundle: boolean;
  workers: IAgentWorkerBuildDto[];
}

// ─── сборка DTO ──────────────────────────────────────────────────────────

const optional = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

export const toWorkerDto = (
  w: IAgentWorkerView,
  catalogVersion?: string,
): IAgentWorkerDto => ({
  name: w.name,
  version: w.version,
  release: w.release,
  state: w.state,
  message: w.message,
  restarts: w.restarts,
  health: w.health,
  pending: w.pending,
  manifest: w.manifest as IAgentWorkerManifestDto | undefined,
  updateAvailable: catalogVersion,
});

export const toConfigDto = (
  agentId: string,
  s: IAgentConfigStatus,
  data?: unknown,
): AgentConfigDto => ({
  agentId,
  worker: s.worker,
  key: s.key,
  version: s.version,
  state: s.state,
  error: s.error,
  data,
  updatedAt: s.updatedAt.getTime(),
  actor: optional(s.actor),
});

export const toCommandDto = (c: AgentCommand): AgentCommandDto => ({
  id: c.id,
  agentId: c.agentId,
  type: c.type,
  worker: optional(c.worker),
  workerType: optional(c.workerType),
  args: optional(c.args),
  status: c.status,
  ok: optional(c.ok),
  result: optional(c.result),
  error: optional(c.error),
  progress: optional(c.progress),
  progressText: optional(c.progressText),
  actor: optional(c.actor),
  createdAt: c.createdAt.getTime(),
  finishedAt: c.finishedAt ? c.finishedAt.getTime() : undefined,
});

export const toEventDto = (e: AgentEvent): IAgentEventDto => ({
  agentId: e.agentId,
  id: e.id,
  worker: e.worker,
  type: e.type,
  data: optional(e.data),
  problems: e.problems?.length ? e.problems : undefined,
  at: e.at,
  receivedAt: e.receivedAt,
});

export const toMetricDto = (m: AgentMetric): IAgentMetricsPointDto => ({
  at: m.at,
  host: optional(m.host),
  workers: optional(m.workers),
});

export const toLogEntryDto = (e: IAgentLogEntry): IAgentLogEntryDto => ({
  ...e,
});

export const toTokenDto = (
  t: AgentEnrollmentToken,
): AgentEnrollmentTokenDto => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  labels: t.labels,
  maxUses: optional(t.maxUses),
  uses: t.uses,
  expiresAt: optional(t.expiresAt),
  revokedAt: optional(t.revokedAt),
  createdBy: optional(t.createdBy),
  createdAt: t.createdAt,
});

/** Проблемы агента по его состоянию и итогам настроек. */
export const agentAlerts = (
  online: boolean,
  workers: IAgentWorkerView[],
  configs: IAgentConfigStatus[],
): IAgentAlertDto[] => {
  if (!online) return [{ kind: "offline", message: "Агент не на связи" }];
  const alerts: IAgentAlertDto[] = [];

  for (const w of workers) {
    if (w.state === "invalid") {
      alerts.push({
        kind: "workerInvalid",
        worker: w.name,
        message: w.message ?? "Воркер не зарегистрировался",
      });
    } else if (w.state === "backoff" || w.state === "stopped") {
      alerts.push({
        kind: "workerDown",
        worker: w.name,
        message: w.state === "backoff" ? "Воркер падает" : "Воркер остановлен",
      });
    } else if (w.state === "running" && w.health && !w.health.ok) {
      alerts.push({
        kind: "workerUnhealthy",
        worker: w.name,
        message: w.health.message || "Воркер нездоров",
      });
    }
  }
  for (const c of configs) {
    if (c.state === "failed") {
      alerts.push({
        kind: "configFailed",
        worker: c.worker,
        key: c.key,
        message: c.error?.message ?? "Воркер не применил настройки",
      });
    }
  }

  return alerts;
};

export type { Agent };
