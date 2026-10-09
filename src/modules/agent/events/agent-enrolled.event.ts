import type { IAgentEnrollmentSource } from "../agent-enrollment.service";
import type { AgentDto } from "../dto";

/**
 * Зарегистрирован новый агент. `source` — чем: созданный токен (кто его
 * создал и его метки) или общий токен окружения. Событие случается в
 * процессе, принявшем регистрацию.
 */
export class AgentEnrolledEvent {
  constructor(
    public readonly agent: AgentDto,
    public readonly source: IAgentEnrollmentSource,
  ) {}
}
