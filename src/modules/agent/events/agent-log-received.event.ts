import type { IAgentLogEntryDto } from "../dto";

/** Пачка записей журнала агента и воркеров. */
export class AgentLogReceivedEvent {
  constructor(
    public readonly agentId: string,
    public readonly entries: IAgentLogEntryDto[],
  ) {}
}
