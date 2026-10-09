/** Кто что сделал с агентом (журнал аудита). */
export class AgentActionAuditedEvent {
  constructor(
    /** `agent.revoke`, `config.set`, `worker.restart`, `fetch`, … */
    public readonly action: string,
    /** Пользователь (`agents.by(userId)`); `null` — система. */
    public readonly actorId: string | null,
    /** Над чем: id агента, `воркер/ключ`, имя воркера. */
    public readonly target: string,
    public readonly agentId: string | null,
    public readonly details: Record<string, unknown>,
  ) {}
}
