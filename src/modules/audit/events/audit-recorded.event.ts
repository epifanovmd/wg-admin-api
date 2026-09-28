import type { AuditEventDto } from "../audit.dto";

/** Событие безопасности записано в журнал. */
export class AuditRecordedEvent {
  constructor(public readonly event: AuditEventDto) {}
}
