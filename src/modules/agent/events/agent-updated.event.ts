import type { AgentDto } from "../dto";

/** Агент изменился: регистрация, связь, `status`, отзыв. */
export class AgentUpdatedEvent {
  constructor(public readonly agent: AgentDto) {}
}
