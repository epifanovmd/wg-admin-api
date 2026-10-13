import type { EntityManager } from "typeorm";

import type { TokenProvider } from "../decorators";

/**
 * Токен multi-inject обработчиков задач: модули регистрируют
 * `asJobHandler(Cls)` или `asExternalJobHandler(Cls)`.
 */
export const JOB_HANDLER = Symbol("JobHandler");

/** Кому принадлежит задача: для прав на просмотр и комнат сокета. */
export interface JobScope {
  type: string;
  id: string;
}

/** Описание очереди: политика повторов, срок, параллельность, расписание. */
export interface JobDefinition {
  /** Имя очереди, `домен.действие`: `mail.send`, `file.process`. */
  queue: string;
  /** Повторов после ошибки (по умолчанию 3). */
  retryLimit?: number;
  /** Задержка первого повтора, секунд (по умолчанию 10). */
  retryDelaySeconds?: number;
  /** Экспоненциальная задержка повторов (по умолчанию true). */
  retryBackoff?: boolean;
  /** Сколько задача может выполняться, секунд (по умолчанию 900). */
  expireInSeconds?: number;
  /** Параллельных задач очереди на процесс; по умолчанию `JOBS_CONCURRENCY`. */
  concurrency?: number;
  /** Cron: очередь запускается по расписанию ровно одним процессом кластера. */
  cron?: string;
  /**
   * Видимая задача: статус, прогресс, лог и отмена в таблице задач и по
   * сокету. Для служебных очередей (почта, очистка) не нужно.
   */
  tracked?: boolean;
  /**
   * Выполняется воркером агента (`EXTERNAL_JOB_EXECUTOR`) как задача его
   * типа (`job`): быстрая — итог сразу, долгая — ход и итог событиями
   * воркера. Передача — сразу после постановки, если подходящий агент на
   * связи; задача pg-boss — повторы передачи и ожидание агента
   * (`retryLimit`, `retryDelaySeconds`). Обработчик — `IExternalJobHandler`;
   * задача всегда видимая; `expireInSeconds` — срок всей работы у воркера.
   */
  external?: boolean;
  /** Для `external`: тип задачи воркера и, если нужно, сам воркер. */
  job?: ExternalJobTarget;
}

/** Контекст выполнения задачи. */
export interface JobContext<T = unknown> {
  id: string;
  queue: string;
  data: T;
  /** Номер попытки, с 0. */
  attempt: number;
  /** Срабатывает при отмене задачи и при остановке процесса. */
  signal: AbortSignal;
  /** Прогресс 0..1 (только для `tracked`; частые вызовы троттлятся). */
  progress(value: number, text?: string): Promise<void>;
  /** Строка лога задачи (только для `tracked`; хранится хвост). */
  log(line: string): Promise<void>;
}

export interface IJobHandler<T = unknown, R = unknown> {
  readonly definition: JobDefinition;
  handle(ctx: JobContext<T>): Promise<R | void>;
}

export interface EnqueueOptions {
  /** Отложить запуск: дата или секунды. */
  startAfter?: Date | number;
  /** Дедупликация: пока задача с этим ключом не завершена, новая не создаётся. */
  singletonKey?: string;
  priority?: number;
  /**
   * Транзакция TypeORM: задача создаётся атомарно с изменениями данных
   * (outbox) — откат транзакции отменяет и задачу.
   */
  manager?: EntityManager;
  /**
   * Вести запись о задаче (статус, прогресс, отмена) и для очереди без
   * `tracked`. Для `tracked` и `external` запись ведётся всегда.
   */
  track?: boolean;
  /** Для видимых задач: заголовок, владелец и область видимости. */
  title?: string;
  ownerId?: string;
  scope?: JobScope;
}

/**
 * Запрос с ожиданием результата: задача ставится сразу (без чужой
 * транзакции — её коммит ждать некому) и всегда ведёт запись.
 */
export type RequestOptions = Omit<
  EnqueueOptions,
  "manager" | "singletonKey" | "startAfter" | "track"
> & {
  /** Сколько ждать результата, мс (по умолчанию 30 000). */
  timeoutMs?: number;
};

/**
 * Очередь задач. Реализация — модуль `jobs` (pg-boss на Postgres): задачи
 * переживают рестарт, выполняются с повторами на процессах `APP_ROLE=worker|all`.
 * Абстрактный класс служит DI-токеном: `@inject(JobQueue)`.
 */
export abstract class JobQueue {
  /** Поставить задачу; `null` — отброшена дедупликацией по `singletonKey`. */
  abstract enqueue<T extends object>(
    queue: string,
    data: T,
    options?: EnqueueOptions,
  ): Promise<string | null>;

  /**
   * Поставить задачу и дождаться результата — запрос-ответ поверх очереди
   * (синхронный инференс, вызов агента из HTTP-запроса). Таймаут
   * отменяет задачу; ошибка задачи или таймаут — `HttpException` (502/504)
   * с кодом ошибки исполнителя в `details`.
   */
  abstract request<T extends object, R = unknown>(
    queue: string,
    data: T,
    options?: RequestOptions,
  ): Promise<R>;

  /** Отменить задачу: активная получит `signal.abort()`. */
  abstract cancel(jobId: string): Promise<void>;
}

/** Ошибка задачи с машинным кодом; `retryable: false` — без повторов. */
export class JobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export const asJobHandler = (
  handler: new (...args: any[]) => IJobHandler<any, any>,
): TokenProvider<IJobHandler> => ({ provide: JOB_HANDLER, useClass: handler });

// ─── Внешние задачи (агенты) ───────────────────────────────────────────

/**
 * Чем выполняется задача внешней очереди: тип задачи воркера агента
 * (`manifest.jobs` воркера) — `POST /jobs` → `200 { result }` (быстрая) или
 * `202 { id }` и события хода (долгая); состояние — `GET /jobs/{id}`, отмена —
 * `POST /jobs/{id}/cancel`.
 */
export interface ExternalJobTarget {
  /** Тип задачи в манифесте воркера: `report.build`. */
  type: string;
  /** Воркер; без него — любой воркер агента, объявивший тип. */
  worker?: string;
}

/** Задача внешней очереди, как её видят хуки. */
export interface ExternalJobInfo<T = unknown> {
  id: string;
  queue: string;
  data: T;
  attempt: number;
}

/**
 * Файлы внешней задачи — ключи хранилища (`FileStorage`): воркер получает на
 * них подписанные ссылки (`inputs` — на чтение, `outputs` — на запись) и сам
 * скачивает и загружает файлы. Ключи выводятся из данных задачи и её id.
 * `contentType` выхода входит в подпись ссылки: воркер загружает файл ровно
 * с этим `Content-Type`.
 */
export interface ExternalJobFiles {
  inputs?: Record<string, string>;
  outputs?: Record<string, string | { key: string; contentType?: string }>;
}

/** Контекст завершения внешней задачи: переносит результат в домен. */
export interface ExternalJobContext<T = unknown> extends ExternalJobInfo<T> {
  /**
   * Транзакция, в которой задача помечается выполненной: изменения домена
   * через неё фиксируются атомарно с завершением задачи.
   */
  manager: EntityManager;
  /** Ключи хранилища выходных файлов (`io`): имя → ключ. */
  outputs: Record<string, string>;
}

/** Окончательная ошибка задачи: повторов больше не будет. */
export interface ExternalJobFailure {
  code: string;
  message: string;
}

/**
 * Обработчик внешней очереди (`definition.external = true`). Саму задачу
 * выполняет воркер агента; в Node остаются хуки: тип задачи (`jobType`),
 * файлы (`io`) и перенос результата (`onComplete`).
 */
export interface IExternalJobHandler<T = unknown, R = unknown> {
  readonly definition: JobDefinition & {
    external: true;
    job: ExternalJobTarget;
  };
  /** Тип задачи воркера для этой задачи (по умолчанию — `definition.job.type`). */
  jobType?(job: ExternalJobInfo<T>): string;
  /** Файлы задачи: ключи хранилища входов и выходов (необязательно). */
  io?(job: ExternalJobInfo<T>): ExternalJobFiles | Promise<ExternalJobFiles>;
  /** Воркер сообщил итог; ошибка хука — задача падает с `JOB_COMPLETE_FAILED`. */
  onComplete(ctx: ExternalJobContext<T>, result: R): Promise<void>;
  /** Задача упала окончательно (необязательно). */
  onFail?(job: ExternalJobInfo<T>, failure: ExternalJobFailure): Promise<void>;
}

/**
 * Исполнитель внешних очередей. Модуль агентов регистрирует
 * `{ provide: EXTERNAL_JOB_EXECUTOR, useClass }`; модуль задач передаёт ему
 * задачи и отражает их ход в своей записи.
 */
export const EXTERNAL_JOB_EXECUTOR = Symbol("ExternalJobExecutor");

/** Подписанные ссылки файлов задачи: имя → URL. */
export interface ExternalJobFileUrls {
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
}

/** Что передаётся исполнителю. */
export interface ExternalJobDispatch {
  jobId: string;
  queue: string;
  /** Номер попытки передачи, с 0. */
  attempt: number;
  data: unknown;
  /** Тип задачи (уже выбранный `jobType`) и воркер. */
  target: ExternalJobTarget;
  files?: ExternalJobFileUrls;
}

/** Где выполняется задача: агент, воркер и id задачи у воркера. */
export interface ExternalJobAssignment {
  agentId: string;
  worker: string;
  workId: string;
}

/** Что сообщил воркер о задаче. */
export type TExternalJobUpdateKind =
  "progress" | "done" | "failed" | "cancelled";

/** Изменение задачи у воркера (ответ на запуск, событие или опрос). */
export interface ExternalJobUpdate extends ExternalJobAssignment {
  kind: TExternalJobUpdateKind;
  /** Id задачи (`job_runs`), если воркер его вернул: связь с записью. */
  jobId?: string;
  /** 0..1. */
  progress?: number;
  text?: string;
  result?: unknown;
  error?: ExternalJobFailure;
}

export interface IExternalJobExecutor {
  /** Процесс может передавать задачи воркерам агентов. */
  readonly canDispatch: boolean;
  /**
   * Выбрать агента с воркером, объявившим тип задачи, и запустить её.
   * Быстрая задача — итог (`done`, `failed`), долгая — `progress` с id
   * задачи у воркера. Ошибка — `JobError` (`retryable` — есть ли смысл
   * повторить передачу).
   */
  dispatch(job: ExternalJobDispatch): Promise<ExternalJobUpdate>;
  /** Состояние задачи у воркера; `null` — воркер о ней не знает. */
  poll(assignment: ExternalJobAssignment): Promise<ExternalJobUpdate | null>;
  /** Отменить задачу у воркера (из любого процесса). */
  cancel(assignment: ExternalJobAssignment): Promise<void>;
  /**
   * Изменения задач от воркеров. Исполнитель ждёт обработчики, прежде чем
   * подтвердить событие агенту: ошибка обработчика — агент пришлёт событие
   * снова, поэтому обработчик идемпотентен. Вернуть отписку.
   */
  onUpdate(listener: (update: ExternalJobUpdate) => Promise<void>): () => void;
  /**
   * Агент снова на связи (или его воркер запущен заново): пора сверить его
   * задачи и передать ждущие.
   */
  onReconnect(listener: (agentId: string) => void): () => void;
}

/** Любой обработчик из `JOB_HANDLER`. */
export type AnyJobHandler =
  IJobHandler<any, any> | IExternalJobHandler<any, any>;

export const isExternalJobHandler = (
  handler: AnyJobHandler,
): handler is IExternalJobHandler<any, any> =>
  handler.definition.external === true;

export const asExternalJobHandler = (
  handler: new (...args: any[]) => IExternalJobHandler<any, any>,
): TokenProvider<AnyJobHandler> => ({
  provide: JOB_HANDLER,
  useClass: handler,
});

// ─── Доступ к видимым задачам ──────────────────────────────────────────

/** Токен multi-inject политик доступа к задачам по их scope. */
export const JOB_ACCESS_POLICY = Symbol("JobAccessPolicy");

export type JobAccessAction = "view" | "cancel";

/**
 * Кто, кроме владельца, видит и отменяет задачи scope: например,
 * проект разрешает своим участникам.
 */
export interface IJobAccessPolicy {
  /** Тип scope, за который отвечает политика: `project`. */
  readonly scopeType: string;
  canAccess(
    userId: string,
    scopeId: string,
    action: JobAccessAction,
  ): Promise<boolean>;
}

export const asJobAccessPolicy = (
  policy: new (...args: any[]) => IJobAccessPolicy,
): TokenProvider<IJobAccessPolicy> => ({
  provide: JOB_ACCESS_POLICY,
  useClass: policy,
});

// ─── Метрики ───────────────────────────────────────────────────────────

/**
 * Необязательный токен метрик задач: реализация (prom-client) привязывается
 * модулем наблюдаемости, очередь вызывает её, если привязана.
 */
export const JOB_METRICS = Symbol("JobMetrics");

export interface IJobMetrics {
  onStart(queue: string): void;
  /** `ok = false` — задача упала или отменена. */
  onComplete(queue: string, durationMs: number, ok: boolean): void;
}
