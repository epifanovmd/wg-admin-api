import type { IAgentMetricsPointDto } from "../dto";

/** Точка метрик агента (каждая, в том числе частая по `watch`). */
export class AgentMetricsReceivedEvent {
  constructor(
    public readonly agentId: string,
    public readonly point: IAgentMetricsPointDto,
  ) {}
}
