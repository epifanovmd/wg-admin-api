import { asJobHandler, Module } from "../../core";
import {
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { AuditController } from "./audit.controller";
import { AuditListener } from "./audit.listener";
import { AuditPermissions } from "./audit.permissions";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";
import { AuditCleanupJob } from "./audit-cleanup.job";
import { AuditEvent } from "./audit-event.entity";
import { AUDIT_ROOM, AuditFeedListener } from "./audit-feed.listener";

/** Журнал событий безопасности. */
@Module({
  entities: [AuditEvent],
  providers: [
    AuditRepository,
    AuditService,
    AuditController,
    asSocketListener(AuditListener),
    asSocketListener(AuditFeedListener),
    asSocketRoomPolicy(permissionRoomPolicy(AUDIT_ROOM, AuditPermissions.VIEW)),
    asJobHandler(AuditCleanupJob),
  ],
})
export class AuditModule {}
