import type { AgentAlertDto } from "../dto";

/** Проблема агента началась (`active`) или закончилась. */
export class AgentAlertChangedEvent {
  constructor(public readonly alert: AgentAlertDto) {}
}
