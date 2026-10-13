/**
 * Действие с агентом: кто (`actorId`, `null` — система), над чем (`target`), агент и
 * подробности.
 */
export class AgentActionAuditedEvent {
  constructor(
    public readonly action: string,
    public readonly actorId: string | null,
    public readonly target: string,
    public readonly agentId: string | null,
    public readonly details?: Record<string, unknown>,
  ) {}
}
