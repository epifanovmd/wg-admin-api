/** Комната списка агентов: изменения агентов и события воркеров. */
export const AGENTS_ROOM = "agents";

/** Тип комнаты одного агента для `room:subscribe { type, id }`. */
export const AGENT_ROOM_TYPE = "agent";

const AGENT_ROOM_PREFIX = "agent_";

/** Комната агента: метрики, журнал (пока клиент в комнате — наблюдение), команды, настройки. */
export const agentRoom = (agentId: string): string =>
  `${AGENT_ROOM_PREFIX}${agentId}`;

/** Id агента из имени его комнаты; `null` — комната не агента. */
export const agentIdOfRoom = (room: string): string | null =>
  room.startsWith(AGENT_ROOM_PREFIX)
    ? room.slice(AGENT_ROOM_PREFIX.length)
    : null;

/** Id агента: 32 шестнадцатеричных символа. */
export const AGENT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const isAgentId = (value: unknown): value is string =>
  typeof value === "string" && AGENT_ID_PATTERN.test(value);

/** Имя воркера и ключа настроек — как у агента. */
export const WORKER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Тип команды и события воркера. */
export const COMMAND_TYPE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

/** Способ установки агента: служба (root), служба пользователя, без установки. */
export const AGENT_INSTALL_MODES = ["systemd", "rootless", "run"] as const;

export type AgentInstallMode = (typeof AGENT_INSTALL_MODES)[number];

export const AGENT_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type TAgentLogLevel = (typeof AGENT_LOG_LEVELS)[number];

/** Наблюдение, пока клиент в комнате агента: метрики раз в секунду, срок — продлевается. */
export const AGENT_WATCH = {
  metricsIntervalMs: 1_000,
  ttlMs: 60_000,
  renewMs: 20_000,
  logLevel: "info" as TAgentLogLevel,
};

/** Сколько ждать итог команды воркеру из REST по умолчанию и не дольше, с. */
export const AGENT_COMMAND_WAIT = { default: 0, max: 120 };
