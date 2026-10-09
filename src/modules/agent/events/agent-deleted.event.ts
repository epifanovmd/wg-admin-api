/** Отозванный агент удалён. */
export class AgentDeletedEvent {
  constructor(public readonly agentId: string) {}
}
