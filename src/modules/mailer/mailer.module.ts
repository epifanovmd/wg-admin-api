import { asJobHandler, Module } from "../../core";
import { MailRenderer } from "./mail-renderer";
import { MailSendJob } from "./mail-send.job";
import { MailerService } from "./mailer.service";

@Module({
  providers: [MailRenderer, MailerService, asJobHandler(MailSendJob)],
})
export class MailerModule {}
