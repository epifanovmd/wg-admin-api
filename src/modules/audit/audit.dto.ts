import { BaseDto } from "../../core/dto/BaseDto";
import { AuditEvent } from "./audit-event.entity";

/** Событие журнала безопасности. */
export class AuditEventDto extends BaseDto {
  id: string;
  /** Тип: `auth.login.succeeded`, `session.terminated`, … */
  type: string;
  actorId: string | null;
  subjectId: string | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;

  constructor(entity: AuditEvent) {
    super(entity);

    this.id = entity.id;
    this.type = entity.type;
    this.actorId = entity.actorId;
    this.subjectId = entity.subjectId;
    this.ip = entity.ip;
    this.userAgent = entity.userAgent;
    this.meta = entity.meta ?? {};
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: AuditEvent) {
    return new AuditEventDto(entity);
  }
}
