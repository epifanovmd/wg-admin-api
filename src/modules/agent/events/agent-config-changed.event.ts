import type { AgentConfigStatusDto } from "../dto";

/** Статус ключа настроек воркера изменился. */
export class AgentConfigChangedEvent {
  constructor(public readonly status: AgentConfigStatusDto) {}
}
