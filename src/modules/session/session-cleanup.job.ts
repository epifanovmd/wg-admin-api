import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { SessionService } from "./session.service";

/** Раз в час удаляет просроченные сессии (одним процессом кластера). */
@Injectable()
export class SessionCleanupJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "session.cleanup",
    cron: "0 * * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(SessionService) private readonly _sessionService: SessionService,
  ) {}

  async handle(): Promise<void> {
    const deleted = await this._sessionService.cleanupExpired();

    if (deleted > 0) {
      logger.info({ deleted }, "[Session] Expired sessions removed");
    }
  }
}
