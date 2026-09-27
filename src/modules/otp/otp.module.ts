import { asJobHandler, Module } from "../../core";
import { Otp } from "./otp.entity";
import { OtpRepository } from "./otp.repository";
import { OtpService } from "./otp.service";
import { OtpCleanupJob } from "./otp-cleanup.job";

@Module({
  entities: [Otp],
  providers: [OtpRepository, OtpService, asJobHandler(OtpCleanupJob)],
})
export class OtpModule {}
