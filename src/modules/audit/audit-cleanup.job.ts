import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { AuditService } from "./audit.service";

/** Раз в сутки удаляет события старше `AUDIT_RETENTION_DAYS`. */
@Injectable()
export class AuditCleanupJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "audit.cleanup",
    cron: "30 3 * * *",
    retryLimit: 2,
    expireInSeconds: 3_600,
  };

  constructor(
    @inject(AuditService) private readonly _auditService: AuditService,
  ) {}

  async handle(): Promise<void> {
    const deleted = await this._auditService.cleanup();

    if (deleted > 0) {
      logger.info({ deleted }, "[Audit] Old events removed");
    }
  }
}
