import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { PasskeysService } from "./passkeys.service";

/** Каждые 15 минут удаляет просроченные WebAuthn-challenge. */
@Injectable()
export class PasskeyChallengeCleanupJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "passkeys.challenge-cleanup",
    cron: "*/15 * * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(PasskeysService) private readonly _passkeysService: PasskeysService,
  ) {}

  async handle(): Promise<void> {
    const deleted = await this._passkeysService.cleanupExpiredChallenges();

    if (deleted > 0) {
      logger.info({ deleted }, "[Passkeys] Expired challenges removed");
    }
  }
}
