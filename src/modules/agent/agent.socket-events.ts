/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { ISocketAckResponse } from "../socket/socket.types";
import type { TAgentLogLevel } from "./agent.types";
import type {
  AgentAlertDto,
  AgentConfigStatusDto,
  AgentDto,
  IAgentActionDto,
  IAgentEventDto,
  IAgentLogEntryDto,
  IAgentMetricsPointDto,
  IAgentReleaseNoticeDto,
} from "./dto";

/** Точка метрик агента. */
export interface IAgentMetricsSocketDto {
  agentId: string;
  point: IAgentMetricsPointDto;
}

/** Записи журнала агента и воркеров (с уровня наблюдателя; клиент фильтрует сам). */
export interface IAgentLogSocketDto {
  agentId: string;
  entries: IAgentLogEntryDto[];
}

/** Уровень журнала наблюдателя агента для этого сокета. */
export interface IAgentLogLevelPayload {
  agentId: string;
  level: TAgentLogLevel;
}

declare module "../socket/socket.types" {
  interface ISocketEvents {
    /** Уровень журнала в комнате агента (по умолчанию `info`); ack `{ ok }`. */
    "agent:log-level": (
      data: IAgentLogLevelPayload,
      ack?: (res: ISocketAckResponse) => void,
    ) => void;
  }

  interface ISocketEmitEvents {
    /** Агент изменился (связь, `status`, отзыв) — `agents` и `agent_<id>`. */
    "agent:updated": (...args: [AgentDto]) => void;
    /** Агент удалён — `agents` и `agent_<id>`. */
    "agent:deleted": (...args: [{ id: string }]) => void;
    /** Проблема началась или закончилась — `agents` и `agent_<id>`. */
    "agent:alert": (...args: [AgentAlertDto]) => void;
    /** Событие воркера — `agents` и `agent_<id>`. */
    "agent:event": (...args: [IAgentEventDto]) => void;
    /** Статус ключа настроек изменился — `agent_<id>`. */
    "agent:config": (...args: [AgentConfigStatusDto]) => void;
    /** Итог действия (перезапуск, обновление, ключ, журнал) — `agent_<id>`. */
    "agent:action": (...args: [IAgentActionDto]) => void;
    /** Точка метрик — `agent_<id>`. */
    "agent:metrics": (...args: [IAgentMetricsSocketDto]) => void;
    /**
     * В источнике выпуска появилась новая версия агента — всем клиентам
     * (от каждой копии бэкенда: может прийти несколько раз).
     */
    "agent:release": (...args: [IAgentReleaseNoticeDto]) => void;
    /** Записи журнала — `agent_<id>`. */
    "agent:log": (...args: [IAgentLogSocketDto]) => void;
  }
}
