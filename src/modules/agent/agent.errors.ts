import { AgentsError } from "agent-sdk/server";

import {
  defineErrors,
  ErrorFactory,
  HttpException,
  HttpStatus,
} from "../../core";
import { AGENT_ELSEWHERE_RETRY_SECONDS } from "./agent.types";

export const AgentError = defineErrors("AGENT", {
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Агент не найден" },
  FORBIDDEN: { status: HttpStatus.FORBIDDEN, message: "Нет доступа к агенту" },
  AGENT_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: "Нет права на все агенты: укажите агента (agentId)",
  },
  REVOKED: { status: HttpStatus.CONFLICT, message: "Агент отозван" },
  OFFLINE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "Агент не на связи",
  },
  ELSEWHERE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      "Агент на связи с другим процессом сервера: повторите запрос через несколько секунд",
  },
  WORKER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "У агента нет такого воркера",
  },
  WORKER_NOT_RELEASED: {
    status: HttpStatus.CONFLICT,
    message:
      "Воркер прописан командой, а не поставлен с сервера: обновить его нельзя",
  },
  CONFIG_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Ключа настроек нет",
  },
  CONFIG_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: "Значение не подходит под схему ключа из манифеста воркера",
  },
  UPDATE_NOT_AVAILABLE: {
    status: HttpStatus.CONFLICT,
    message: "Обновление недоступно: нет новой версии или сборки под агента",
  },
  STORE_CONFLICT: {
    status: HttpStatus.CONFLICT,
    message: "Запись агента меняется другими процессами, повторите",
  },
  TIMEOUT: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: "Агент не ответил в срок",
  },
  TOO_LARGE: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: "Слишком большое тело запроса или значение",
  },
  INVALID_REQUEST: {
    status: HttpStatus.BAD_REQUEST,
    message: "Некорректный запрос к агенту",
  },
  ROUTE_UNDECLARED: {
    status: HttpStatus.NOT_FOUND,
    message:
      "Воркер не объявил такой маршрут в манифесте: агент не передаёт запрос",
  },
  JOB_UNKNOWN: {
    status: HttpStatus.CONFLICT,
    message: "Воркер не объявил такой тип задачи в манифесте",
  },
  REQUEST_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: "Тело запроса не подходит под схему маршрута из манифеста воркера",
  },
  EVENT_UNDECLARED: {
    status: HttpStatus.CONFLICT,
    message: "Воркер не объявил такой тип события в манифесте",
  },
  NOT_WATCHED: {
    status: HttpStatus.CONFLICT,
    message: "Сначала войдите в комнату агента (room:subscribe)",
  },
  ENROLLMENT_TOKEN_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Токен регистрации не найден",
  },
});

/** Коды ошибок SDK → доменные ошибки модуля. */
const SDK_ERRORS: Record<string, ErrorFactory> = {
  AGENT_NOT_FOUND: AgentError.NOT_FOUND,
  AGENT_REVOKED: AgentError.REVOKED,
  AGENT_OFFLINE: AgentError.OFFLINE,
  WORKER_UNKNOWN: AgentError.WORKER_NOT_FOUND,
  WORKER_NOT_RELEASED: AgentError.WORKER_NOT_RELEASED,
  CONFIG_INVALID: AgentError.CONFIG_INVALID,
  UPDATE_NOT_AVAILABLE: AgentError.UPDATE_NOT_AVAILABLE,
  CONFLICT: AgentError.STORE_CONFLICT,
  TIMEOUT: AgentError.TIMEOUT,
  BODY_TOO_LARGE: AgentError.TOO_LARGE,
  MESSAGE_INVALID: AgentError.INVALID_REQUEST,
  ROUTE_UNDECLARED: AgentError.ROUTE_UNDECLARED,
  JOB_UNKNOWN: AgentError.JOB_UNKNOWN,
  REQUEST_INVALID: AgentError.REQUEST_INVALID,
  EVENT_UNDECLARED: AgentError.EVENT_UNDECLARED,
};

/**
 * Ошибка SDK агентов → доменная (`AGENT_*`): текст SDK — в `details.reason`.
 * `AGENT_ELSEWHERE` (соединение агента в другом процессе) — 503 с
 * `details.retryAfter`. Коды агента и воркера (`WORKER_UNAVAILABLE`,
 * `ACTION_FAILED`, …) — со статусом и кодом SDK. Прочие ошибки — как есть.
 */
export const toAgentError = (err: unknown): unknown => {
  if (!(err instanceof AgentsError)) return err;
  if (err.code === "AGENT_ELSEWHERE") {
    return AgentError.ELSEWHERE({
      reason: err.message,
      retryAfter: AGENT_ELSEWHERE_RETRY_SECONDS,
    });
  }

  const factory = SDK_ERRORS[err.code];

  return factory
    ? factory({ reason: err.message })
    : new HttpException(err.message, err.status, undefined, err.code);
};

/** Вызов SDK с переводом его ошибок в доменные. */
export const callAgents = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    throw toAgentError(err);
  }
};

/**
 * `AGENT_ELSEWHERE` → заголовок `Retry-After`: клиент повторит запрос, и
 * балансировщик, возможно, приведёт его в процесс с соединением агента.
 */
export const withRetryAfter = async <T>(
  setHeader: (name: string, value: string) => void,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (err) {
    if (
      err instanceof HttpException &&
      err.code === AgentError.codes.ELSEWHERE
    ) {
      setHeader("Retry-After", String(AGENT_ELSEWHERE_RETRY_SECONDS));
    }
    throw err;
  }
};
