/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module работает только с
 * модулем-объявлением, не с index).
 */
import type { ISocketAckResponse } from "../socket/socket.types";
import type { TAgentLogLevel } from "./agent.types";
import type {
  AgentCommandDto,
  AgentConfigDto,
  AgentDto,
  IAgentEventDto,
  IAgentLogEntryDto,
  IAgentMetricsPointDto,
} from "./dto";

export interface IAgentMetricsSocketDto {
  agentId: string;
  point: IAgentMetricsPointDto;
}

export interface IAgentLogSocketDto {
  agentId: string;
  entries: IAgentLogEntryDto[];
}

export interface IAgentLogLevelPayload {
  agentId: string;
  level: TAgentLogLevel;
}

declare module "../socket/socket.types" {
  interface ISocketEvents {
    /** Уровень журнала наблюдения в комнате агента (по умолчанию `info`); ack `{ ok }`. */
    "agent:log-level": (
      data: IAgentLogLevelPayload,
      ack?: (res: ISocketAckResponse) => void,
    ) => void;
  }

  interface ISocketEmitEvents {
    /** Агент изменился (связь, hello, состояние, отзыв) — `agents` и `agent_<id>`. */
    "agent:updated": (...args: [AgentDto]) => void;
    /** Агент удалён — `agents` и `agent_<id>`. */
    "agent:deleted": (...args: [{ id: string }]) => void;
    /** Событие воркера — `agents` и `agent_<id>`. */
    "agent:event": (...args: [IAgentEventDto]) => void;
    /** Ключ настроек записан, удалён или применён — `agent_<id>`. */
    "agent:config": (...args: [AgentConfigDto]) => void;
    /** Команда поставлена, её ход или итог — `agent_<id>`. */
    "agent:command": (...args: [AgentCommandDto]) => void;
    /** Точка метрик — `agent_<id>`. */
    "agent:metrics": (...args: [IAgentMetricsSocketDto]) => void;
    /** Записи журнала — `agent_<id>`. */
    "agent:log": (...args: [IAgentLogSocketDto]) => void;
  }
}
