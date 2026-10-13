/** Кто что сделал с агентом (журнал аудита). */
export class AgentActionAuditedEvent {
  constructor(
    /** `agent.enroll`, `agent.revoke`, `agent.delete`, `config.set`, `worker.restart`, `fetch`, … */
    public readonly action: string,
    /** Пользователь; `null` — система. */
    public readonly actorId: string | null,
    /** Над чем: воркер (настройки, запрос к воркеру) или id агента. */
    public readonly target: string,
    public readonly agentId: string | null,
    public readonly details: Record<string, unknown>,
  ) {}
}
