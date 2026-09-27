/** Статус видимой задачи. */
export enum EJobRunStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/** Итоговые статусы: задача больше не выполняется. */
export const SETTLED_JOB_RUN_STATUSES: readonly EJobRunStatus[] = [
  EJobRunStatus.COMPLETED,
  EJobRunStatus.FAILED,
  EJobRunStatus.CANCELLED,
];

/** Статусы, из которых задачу ещё можно отменить. */
export const ACTIVE_JOB_RUN_STATUSES: readonly EJobRunStatus[] = [
  EJobRunStatus.QUEUED,
  EJobRunStatus.RUNNING,
];

/** Ошибка задачи в записи и в ответе API. */
export interface IJobRunError {
  code: string;
  message: string;
}

/** Схема таблиц pg-boss. */
export const PGBOSS_SCHEMA = "pgboss";
/** Канал NOTIFY об отмене задачи; payload — id задачи. */
export const JOB_CANCEL_CHANNEL = "job_cancel";
/** Канал NOTIFY о завершении видимой задачи; payload — id задачи. */
export const JOB_SETTLED_CHANNEL = "job_settled";
/** Все каналы сигналов задач: слушаются одним соединением. */
export const JOB_SIGNAL_CHANNELS = [
  JOB_CANCEL_CHANNEL,
  JOB_SETTLED_CHANNEL,
] as const;
export type TJobSignalChannel = (typeof JOB_SIGNAL_CHANNELS)[number];
/** Ожидание результата (`request`) без LISTEN — опрос записи с этим шагом. */
export const JOB_RESULT_POLL_MS = 1_000;
/** Ожидание результата по умолчанию. */
export const JOB_REQUEST_TIMEOUT_MS = 30_000;
/** Опрос отмен, если LISTEN недоступен (PgBouncer в transaction mode). */
export const JOB_CANCEL_POLL_MS = 2_000;
/** Прогресс и лог пишутся в БД не чаще раза в этот интервал. */
export const JOB_PROGRESS_THROTTLE_MS = 500;
/** Сколько последних строк лога хранится. */
export const JOB_LOG_TAIL_SIZE = 200;
/** Длина одной строки лога. */
export const JOB_LOG_LINE_MAX = 1_000;
/** Аренда задачи Node-воркером; продлевается каждую треть срока. */
export const JOB_INTERNAL_LEASE_SECONDS = 60;
/** Предел pg-boss на выполнение задачи (`expireInSeconds`) — сутки. */
export const JOB_MAX_EXPIRE_SECONDS = 24 * 3_600;
/** Очередь cron-задачи, возвращающей задачи с истёкшей арендой. */
export const LEASE_REAPER_QUEUE = "jobs.lease-reaper";
/** Очередь cron-задачи, удаляющей старые завершённые записи задач. */
export const JOB_RETENTION_QUEUE = "jobs.retention";
