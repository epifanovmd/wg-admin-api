import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { OtpRepository } from "./otp.repository";

/** Каждые 30 минут удаляет просроченные коды. */
@Injectable()
export class OtpCleanupJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "otp.cleanup",
    cron: "*/30 * * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(OtpRepository) private readonly _otpRepository: OtpRepository,
  ) {}

  async handle(): Promise<void> {
    const deleted = await this._otpRepository.deleteExpired();

    if (deleted > 0) {
      logger.info({ deleted }, "[Otp] Expired codes removed");
    }
  }
}
