/** Комната списка агентов: изменения агентов, проблемы, события воркеров. */
export const AGENTS_ROOM = "agents";

/** Тип комнаты одного агента для `room:subscribe { type, id }`. */
export const AGENT_ROOM_TYPE = "agent";

const AGENT_ROOM_PREFIX = "agent_";

/**
 * Комната агента: точки метрик и журнал (пока клиент в комнате — `watch`),
 * события воркеров, статусы настроек, итоги действий, изменения агента.
 */
export const agentRoom = (agentId: string): string =>
  `${AGENT_ROOM_PREFIX}${agentId}`;

/** Id агента из имени его комнаты; `null` — комната не агента. */
export const agentIdOfRoom = (room: string): string | null =>
  room.startsWith(AGENT_ROOM_PREFIX)
    ? room.slice(AGENT_ROOM_PREFIX.length)
    : null;

/** Id агента, который выдаёт SDK: 32 шестнадцатеричных символа. */
export const AGENT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const isAgentId = (value: unknown): value is string =>
  typeof value === "string" && AGENT_ID_PATTERN.test(value);

/** Длина id агента в колонках. */
export const AGENT_ID_MAX = 64;

/** Имя воркера и ключа настроек — как у агента. */
export const WORKER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Длина имени воркера и ключа настроек. */
export const WORKER_NAME_MAX = 32;

/** Тип события воркера. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

/** Длина типа события. */
export const EVENT_TYPE_MAX = 64;

/** Уровни журнала агента — от подробного к важному. */
export const AGENT_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type TAgentLogLevel = (typeof AGENT_LOG_LEVELS)[number];

/** Наблюдение (`watch`), пока клиент в комнате агента. */
export const AGENT_WATCH = {
  /** Частота метрик, мс. */
  metricsIntervalMs: 1_000,
  /** Срок наблюдателя без продления, мс. */
  ttlMs: 30_000,
  /** Продление, мс (меньше срока). */
  renewMs: 20_000,
  /** Уровень журнала по умолчанию. */
  logLevel: "info" as TAgentLogLevel,
};

/** Канал NOTIFY: агенты, изменённые в другом процессе (payload — JSON). */
export const AGENTS_CHANGED_CHANNEL = "agents_changed";

/**
 * Маршрут пересылки вызовов агентов между копиями API (`relay`) на
 * внутреннем сервере пересылки (`AGENT_RELAY_PORT`): закрыт общим секретом
 * `AGENT_RELAY_SECRET`.
 */
export const AGENT_RELAY_PATH = "/internal/agent-relay";

/** Заголовок ответа прокси запроса к воркеру: статус ответа воркера. */
export const AGENT_WORKER_STATUS_HEADER = "X-Agent-Worker-Status";

/** Запросы к воркеру, которые попадают в аудит: изменяющие. */
export const AGENT_AUDITED_FETCH_METHODS: readonly string[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** Очередь cron-уборки событий и истории метрик. */
export const AGENT_PRUNE_QUEUE = "agents.prune";

/** «Агент на связи с другим процессом»: повторить через, с. */
export const AGENT_ELSEWHERE_RETRY_SECONDS = 2;

/** Срок запроса к воркеру по умолчанию и предел, мс. */
export const AGENT_FETCH_TIMEOUT = { defaultMs: 30_000, maxMs: 600_000 };

/** Тело запроса к воркеру — не больше, байт (предел агента — 4 МБ). */
export const AGENT_FETCH_BODY_MAX = 4 * 1024 * 1024;

/** Встроенное действие агента. */
export type TAgentActionName =
  | "worker.restart"
  | "worker.update"
  | "agent.update"
  | "agent.rotateKey"
  | "agent.logs";

/** Длина открытой части токена регистрации (`<prefix>.<secret>`), символов. */
export const ENROLLMENT_TOKEN_PREFIX_LENGTH = 8;
