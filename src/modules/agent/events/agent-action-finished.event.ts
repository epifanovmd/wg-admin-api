import type { IAgentActionDto } from "../dto";

/** Итог встроенного действия агента (перезапуск, обновление, ключ, журнал). */
export class AgentActionFinishedEvent {
  constructor(public readonly action: IAgentActionDto) {}
}
