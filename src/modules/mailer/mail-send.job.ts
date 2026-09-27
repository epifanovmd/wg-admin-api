import { inject } from "inversify";

import { IJobHandler, Injectable, JobContext, JobDefinition } from "../../core";
import { MailerService } from "./mailer.service";
import { IMailSendJobData, MAIL_SEND_QUEUE } from "./mailer.types";

/** Обработчик `mail.send`: рендер и отправка письма, 5 повторов с backoff. */
@Injectable()
export class MailSendJob implements IJobHandler<IMailSendJobData> {
  readonly definition: JobDefinition = {
    queue: MAIL_SEND_QUEUE,
    retryLimit: 5,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 120,
  };

  constructor(@inject(MailerService) private readonly _mailer: MailerService) {}

  handle(ctx: JobContext<IMailSendJobData>): Promise<void> {
    return this._mailer.deliver(ctx.data);
  }
}
