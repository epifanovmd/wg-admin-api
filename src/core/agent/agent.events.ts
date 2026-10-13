import type { Agent } from "./agent.entity";
import type { AgentCommand } from "./agent-command.entity";
import type { IAgentEnrollmentSource } from "./agent-enrollment.service";
import type { IAgentEvent, IAgentLogEntry, IAgentMetrics } from "./protocol";

/** Агент зарегистрирован: источник — токен (id, кто создал, метки) или общий токен. */
export class AgentEnrolledEvent {
  constructor(
    public readonly agent: Agent,
    public readonly source: IAgentEnrollmentSource,
  ) {}
}

/**
 * Изменилось то, что агент сообщает о себе или связь с ним: hello, состояние, поток открыт
 * или закрыт. `reason` — что именно.
 */
export class AgentUpdatedEvent {
  constructor(
    public readonly agent: Agent,
    public readonly reason:
      "hello" | "state" | "online" | "offline" | "revoked" | "watch",
  ) {}
}

/** Агент снова на связи (поток открыт): сверить его задачи. */
export class AgentConnectedEvent {
  constructor(public readonly agent: Agent) {}
}

export class AgentDeletedEvent {
  constructor(public readonly agentId: string) {}
}

/** Изменилось желаемое: ключ настроек воркера записан или удалён. */
export class AgentConfigChangedEvent {
  constructor(
    public readonly agentId: string,
    public readonly worker: string,
    public readonly key: string,
    public readonly version: number,
    public readonly deleted: boolean,
  ) {}
}

/** Воркер применил (или не применил) ключ настроек — из состояния агента. */
export class AgentConfigAppliedEvent {
  constructor(
    public readonly agentId: string,
    public readonly worker: string,
    public readonly key: string,
    public readonly version: number,
    public readonly ok: boolean | undefined,
    public readonly error: { code: string; message: string } | undefined,
  ) {}
}

/** Событие воркера принято (новое, записано в историю). */
export class AgentEventReceivedEvent {
  constructor(
    public readonly agentId: string,
    public readonly event: IAgentEvent,
  ) {}
}

export class AgentMetricsReceivedEvent {
  constructor(
    public readonly agentId: string,
    public readonly point: IAgentMetrics,
  ) {}
}

export class AgentLogReceivedEvent {
  constructor(
    public readonly agentId: string,
    public readonly entries: IAgentLogEntry[],
  ) {}
}

/** Команда поставлена (запись в БД; агент получит её в потоке). */
export class AgentCommandQueuedEvent {
  constructor(public readonly command: AgentCommand) {}
}

/** Ход долгой команды воркера. */
export class AgentCommandProgressEvent {
  constructor(public readonly command: AgentCommand) {}
}

/** Итог команды записан. */
export class AgentCommandFinishedEvent {
  constructor(public readonly command: AgentCommand) {}
}
