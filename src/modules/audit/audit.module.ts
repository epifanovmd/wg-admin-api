import { asJobHandler, Module } from "../../core";
import { asSocketListener } from "../socket";
import { AuditController } from "./audit.controller";
import { AuditListener } from "./audit.listener";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";
import { AuditCleanupJob } from "./audit-cleanup.job";
import { AuditEvent } from "./audit-event.entity";

/** Журнал событий безопасности. */
@Module({
  entities: [AuditEvent],
  providers: [
    AuditRepository,
    AuditService,
    AuditController,
    asSocketListener(AuditListener),
    asJobHandler(AuditCleanupJob),
  ],
})
export class AuditModule {}
