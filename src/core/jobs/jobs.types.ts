import type { EntityManager } from "typeorm";

import type { TokenProvider } from "../decorators";

/**
 * Токен multi-inject обработчиков задач: модули регистрируют
 * `asJobHandler(Cls)`.
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
   * `tracked`. Для `tracked` запись ведётся всегда.
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
   * Поставить задачу и дождаться результата — запрос-ответ поверх очереди.
   * Таймаут отменяет задачу; ошибка задачи или таймаут — `HttpException`
   * (502/504) с кодом ошибки задачи в `details`.
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

// ─── Доступ к видимым задачам ──────────────────────────────────────────

/** Токен multi-inject политик доступа к задачам по их scope. */
export const JOB_ACCESS_POLICY = Symbol("JobAccessPolicy");

export type JobAccessAction = "view" | "cancel";

/**
 * Кто, кроме владельца, видит и отменяет задачи scope: например,
 * рабочее пространство разрешает своим участникам.
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
