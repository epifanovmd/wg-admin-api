import type {
  Agent,
  AgentWorker,
  Alert,
  AlertEvent,
  ConfigStatus,
  MetricsPoint,
  WorkerManifest,
} from "agent-sdk/server";

import { BaseDto } from "../../../core/dto/BaseDto";
import type { TAgentLogLevel } from "../agent.types";

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

/** Узел агента. */
export interface IAgentHostDto {
  os: string;
  arch: string;
  hostname: string;
  kernel?: string;
}

/** Последний ответ воркера на `GET /health`. */
export interface IAgentWorkerHealthDto {
  ok: boolean;
  /** Идёт долгая работа: плановая замена воркера ждёт её окончания. */
  busy?: boolean;
  message?: string;
  /** Сведения от воркера (версии, порты и т. п.). */
  info?: Record<string, unknown>;
}

/** Ключ настроек в манифесте воркера. */
export interface IAgentManifestConfigDto {
  key: string;
  description?: string;
  /** JSON Schema значения. */
  schema?: Record<string, unknown>;
}

/**
 * Маршрут воркера в манифесте: `{name}` в пути — один сегмент. Агент
 * пропускает к воркеру только объявленные маршруты (`ROUTE_UNDECLARED`).
 */
export interface IAgentManifestRouteDto {
  method: string;
  path: string;
  description?: string;
  /** JSON Schema тела запроса: сервер проверяет тело до отправки. */
  request?: Record<string, unknown>;
  /** JSON Schema тела ответа `2xx` — описание, не проверяется. */
  response?: Record<string, unknown>;
}

/** Тип события воркера в манифесте: другие типы агент не принимает. */
export interface IAgentManifestEventDto {
  type: string;
  description?: string;
  /** JSON Schema `data` события. */
  schema?: Record<string, unknown>;
}

/** Запрос воркера к серверу (`POST /requests` на сокете агента). */
export interface IAgentManifestRequestDto {
  type: string;
  description?: string;
  /** JSON Schema `data` запроса: сервер проверяет до обработчика. */
  schema?: Record<string, unknown>;
  /** JSON Schema `data` ответа — описание, не проверяется. */
  response?: Record<string, unknown>;
}

/** Тип задачи воркера в манифесте (`POST /jobs`). */
export interface IAgentManifestJobDto {
  type: string;
  description?: string;
  /** JSON Schema `data` задачи. */
  schema?: Record<string, unknown>;
}

/**
 * Манифест воркера — ответ `GET /manifest`: что воркер умеет (каталог
 * возможностей). Агент пропускает только объявленное: маршруты, типы задач,
 * события, запросы к серверу, ключи настроек.
 */
export interface IAgentWorkerManifestDto {
  version: string;
  description?: string;
  configs: IAgentManifestConfigDto[];
  routes: IAgentManifestRouteDto[];
  events: IAgentManifestEventDto[];
  jobs: IAgentManifestJobDto[];
  requests: IAgentManifestRequestDto[];
}

/** Что агент сообщил о ключе настроек: версия на диске и итог применения. */
export interface IAgentWorkerConfigReportDto {
  version: number;
  /** Нет — ещё применяется. */
  ok?: boolean;
  error?: IAgentErrorDto;
}

/**
 * Воркер агента: из `hello` и последнего `status`. `state` — `starting`,
 * `running` (зарегистрирован), `invalid` (не ответил как нужно на
 * `GET /health` или `GET /manifest`, причина — `message`), `backoff`,
 * `stopped`.
 */
export interface IAgentWorkerDto {
  name: string;
  state?: string;
  message?: string;
  version?: string;
  /** Ставится и обновляется с сервера (`release: true`). */
  release?: boolean;
  /** Встроенный `sysmetrics`: часть агента. */
  builtin?: boolean;
  restarts?: number;
  health?: IAgentWorkerHealthDto;
  /** `restart` | `update` — замена ждёт, пока воркер занят. */
  pending?: string;
  manifest?: IAgentWorkerManifestDto;
  /** Ключ → что на диске агента и итог применения. */
  configs?: Record<string, IAgentWorkerConfigReportDto>;
}

/** Точка метрик: узел (`host`) и ответы `GET /metrics` воркеров. */
export interface IAgentMetricsPointDto {
  /** Время сбора на узле, мс. */
  at: number;
  host?: Record<string, unknown>;
  workers?: Record<string, unknown>;
}

/** Какой процесс сервера держит соединение агента. */
export interface IAgentSessionDto {
  id: string;
  instance: string;
  since: number;
}

/** Проблема агента. */
export class AgentAlertDto extends BaseDto {
  /** Ключ в пределах агента: `offline`, `workerDown:<воркер>`, … */
  key: string;
  agentId: string;
  agentName: string;
  /** `offline` | `workerDown` | `workerInvalid` | `workerUnhealthy` | `configFailed`. */
  type: string;
  worker?: string;
  configKey?: string;
  message: string;
  /** С какого времени, мс. */
  since: number;
  /** В событии: `true` — началась, `false` — закончилась. */
  active?: boolean;

  constructor(alert: Alert | AlertEvent) {
    super(alert);

    this.key = alert.key;
    this.agentId = alert.agentId;
    this.agentName = alert.agentName;
    this.type = alert.type;
    if (alert.worker) this.worker = alert.worker;
    if (alert.configKey) this.configKey = alert.configKey;
    this.message = alert.message;
    this.since = alert.since;
    if ("active" in alert) this.active = alert.active;
  }

  static fromModel(alert: Alert | AlertEvent): AgentAlertDto {
    return new AgentAlertDto(alert);
  }
}

const manifestDto = (
  manifest: WorkerManifest | undefined,
): IAgentWorkerManifestDto | undefined =>
  manifest && {
    version: manifest.version ?? "",
    ...(manifest.description && { description: manifest.description }),
    configs: manifest.configs ?? [],
    routes: manifest.routes ?? [],
    events: manifest.events ?? [],
    jobs: manifest.jobs ?? [],
    requests: manifest.requests ?? [],
  };

const workerDto = (worker: AgentWorker): IAgentWorkerDto => ({
  name: worker.name,
  ...(worker.state && { state: worker.state }),
  ...(worker.message && { message: worker.message }),
  ...(worker.version && { version: worker.version }),
  ...(worker.release !== undefined && { release: worker.release }),
  ...(worker.builtin && { builtin: true }),
  ...(worker.restarts !== undefined && { restarts: worker.restarts }),
  ...(worker.health && {
    health: {
      ok: worker.health.ok,
      ...(worker.health.busy !== undefined && { busy: worker.health.busy }),
      ...(worker.health.message && { message: worker.health.message }),
      ...(worker.health.info && { info: worker.health.info }),
    },
  }),
  ...(worker.pending && { pending: worker.pending }),
  ...(worker.manifest && { manifest: manifestDto(worker.manifest) }),
  ...(worker.configs && {
    configs: Object.fromEntries(
      Object.entries(worker.configs).map(([key, report]) => [
        key,
        {
          version: report.version,
          ...(report.ok !== undefined && { ok: report.ok }),
          ...(report.error && { error: report.error }),
        },
      ]),
    ),
  }),
});

export const toMetricsPointDto = (
  point: Pick<MetricsPoint, "at" | "host" | "workers">,
): IAgentMetricsPointDto => ({
  at: point.at,
  ...(point.host && { host: point.host }),
  ...(point.workers && { workers: point.workers }),
});

/**
 * Агент, как его видит бэкенд: связь, узел, воркеры (состояние, самочувствие,
 * манифест, настройки), последняя точка метрик, текущие проблемы.
 */
export class AgentDto extends BaseDto {
  id: string;
  name: string;
  labels: Record<string, string>;
  online: boolean;
  revoked: boolean;
  /** Время регистрации, мс. */
  enrolledAt: number;
  lastSeenAt?: number;
  connectedAt?: number;
  /** IP последнего подключения. */
  address?: string;
  /** Версия агента. */
  version?: string;
  bootId?: string;
  startedAt?: number;
  host?: IAgentHostDto;
  workers: IAgentWorkerDto[];
  /** Когда пришёл последний `status`, мс. */
  statusAt?: number;
  /** Сколько важных сообщений агента ждут подтверждения. */
  outbox?: number;
  /** Последняя точка метрик. */
  metrics?: IAgentMetricsPointDto;
  alerts: AgentAlertDto[];
  session?: IAgentSessionDto;

  constructor(agent: Agent) {
    super(agent);

    this.id = agent.id;
    this.name = agent.name;
    this.labels = agent.labels;
    this.online = agent.online;
    this.revoked = agent.revoked;
    this.enrolledAt = agent.enrolledAt;
    if (agent.lastSeenAt !== undefined) this.lastSeenAt = agent.lastSeenAt;
    if (agent.connectedAt !== undefined) this.connectedAt = agent.connectedAt;
    if (agent.address) this.address = agent.address;
    if (agent.version) this.version = agent.version;
    if (agent.bootId) this.bootId = agent.bootId;
    if (agent.startedAt !== undefined) this.startedAt = agent.startedAt;
    if (agent.host) {
      this.host = {
        os: agent.host.os,
        arch: agent.host.arch,
        hostname: agent.host.hostname,
        ...(agent.host.kernel && { kernel: agent.host.kernel }),
      };
    }
    this.workers = agent.workers.map(workerDto);
    if (agent.statusAt !== undefined) this.statusAt = agent.statusAt;
    if (agent.status) this.outbox = agent.status.outbox;
    if (agent.metrics) this.metrics = toMetricsPointDto(agent.metrics);
    this.alerts = agent.alerts.map(AgentAlertDto.fromModel);
    if (agent.session) this.session = { ...agent.session };
  }

  static fromModel(agent: Agent): AgentDto {
    return new AgentDto(agent);
  }
}

/** Статус ключа настроек воркера на агенте. */
export class AgentConfigStatusDto extends BaseDto {
  agentId: string;
  worker: string;
  key: string;
  /** Желаемая версия; `null` — ключ удалён, агент ещё не удалил. */
  version: number | null;
  /** Версия на диске агента. */
  delivered?: number;
  /** Последняя версия, применённая воркером. */
  applied?: number;
  /**
   * `pending` | `applying` | `applied` | `failed` | `deleting`; `deleted` —
   * агент удалил ключ (только в событии сокета `agent:config`).
   */
  state: string;
  error?: IAgentErrorDto;
  /** Подробный итог применения от воркера (только в `applied`). */
  result?: unknown;
  updatedAt?: number;

  constructor(status: ConfigStatus) {
    super(status);

    this.agentId = status.agentId;
    this.worker = status.worker;
    this.key = status.key;
    this.version = status.version;
    if (status.delivered !== undefined) this.delivered = status.delivered;
    if (status.applied !== undefined) this.applied = status.applied;
    this.state = status.state;
    if (status.error) this.error = status.error;
    if (status.result !== undefined) this.result = status.result;
    if (status.updatedAt !== undefined) this.updatedAt = status.updatedAt;
  }

  static fromModel(status: ConfigStatus): AgentConfigStatusDto {
    return new AgentConfigStatusDto(status);
  }
}

/** Значение ключа настроек воркера. */
export interface IAgentConfigDto {
  agentId: string;
  worker: string;
  key: string;
  version: number;
  /** Значение; только с правом на настройки (`agent:config`). */
  data?: unknown;
  /** Время записи, мс. */
  updatedAt: number;
  /** Кто изменил. */
  actor?: string;
}

/** Ключ настроек: значение (если задано) и статус применения. */
export interface IAgentConfigEntryDto {
  worker: string;
  key: string;
  /** Желаемое значение; нет — ключ удалён и ещё удаляется на агенте. */
  config?: IAgentConfigDto;
  status: AgentConfigStatusDto;
}

/** Событие воркера. */
export interface IAgentEventDto {
  /** Id сообщения агента. */
  id: string;
  agentId: string;
  worker: string;
  type: string;
  data?: unknown;
  /** Когда случилось на узле, мс. */
  at: number;
  /** Когда принято, мс. */
  receivedAt: number;
  /** `data` не подошло под схему события из манифеста воркера: замечания. */
  problems?: string[];
}

/** Запись журнала агента или воркера. */
export interface IAgentLogEntryDto {
  /** Время, мс. */
  at: number;
  level: TAgentLogLevel;
  /** `agent` или имя воркера. */
  source: string;
  msg: string;
  attrs?: Record<string, unknown>;
}

/** Последние строки журнала. */
export interface IAgentLogsDto {
  entries: IAgentLogEntryDto[];
}

/** Итог встроенного действия агента. */
export interface IAgentActionDto {
  id: string;
  agentId: string;
  /** `worker.restart` | `worker.update` | `agent.update` | `agent.rotateKey` | `agent.logs`. */
  name: string;
  args?: Record<string, unknown>;
  actor?: string;
  /** `done` | `failed`. */
  status: string;
  result?: unknown;
  error?: IAgentErrorDto;
  createdAt: number;
  finishedAt: number;
  /** Итог отложенной замены воркера (перезапуск или обновление ждали окончания работы). */
  deferred?: boolean;
}

/** Итог обновления агента. */
export interface IAgentUpdateResultDto {
  version: string;
  previous?: string;
}

/**
 * Ответ на перезапуск и обновление воркера. Воркер свободен — заменён сразу
 * (`deferred: false`, у обновления — версии). Занят (`health.busy`) — замена
 * отложена до окончания работы (`deferred: true`, `pending`, `actionId`);
 * её итог — событие сокета `agent:action` с `id = actionId` и `deferred: true`.
 */
export interface IAgentWorkerActionResultDto {
  deferred: boolean;
  /** Что ждёт: `restart` | `update`. */
  pending?: string;
  /** Id действия: по нему узнаётся итог в `agent:action`. */
  actionId?: string;
  /** Обновление: новая версия воркера. */
  version?: string;
  /** Обновление: прежняя версия. */
  previous?: string;
}

/** Тело перезапуска и обновления воркера. */
export interface IAgentWorkerActionBody {
  /** Заменить сразу, не дожидаясь окончания работы воркера (`busy`). */
  force?: boolean;
}

/** Тело записи настроек воркера. */
export interface ISetAgentConfigBody {
  /** Значение ключа — любой JSON; проверяется по схеме из манифеста воркера. */
  data: unknown;
}

/** Запрос к воркеру через агента. */
export interface IAgentFetchBody {
  /**
   * HTTP-метод.
   * @pattern ^[A-Z]{1,16}$
   */
  method?: string;
  /**
   * Путь у воркера от `/`, с параметрами.
   * @maxLength 2048
   */
  path: string;
  /** Заголовки запроса. */
  headers?: Record<string, string>;
  /** Тело: текст или base64 (`encoding: "base64"`). */
  body?: string;
  /** `utf8` (по умолчанию) | `base64`. */
  encoding?: "utf8" | "base64";
  /** Срок, мс (по умолчанию 30 000, не больше 600 000). */
  timeoutMs?: number;
}
