import type { IAgentEventDto } from "../dto";

/** Событие воркера сохранено (после обработчиков, до подтверждения агенту). */
export class AgentEventReceivedEvent {
  constructor(public readonly event: IAgentEventDto) {}
}
