import { inject } from "inversify";
import { createTransport } from "nodemailer";

import { config, isProduction } from "../../config";
import {
  HttpException,
  Injectable,
  JobError,
  JobQueue,
  logger,
} from "../../core";
import { MailRenderer } from "./mail-renderer";
import { MailError } from "./mailer.errors";
import {
  IMailSendJobData,
  IMailTemplateData,
  IRenderedMail,
  ISendMailOptions,
  MAIL_SEND_QUEUE,
  resolveMailLocale,
  TMailTemplate,
} from "./mailer.types";

/** SMTP-коды 5xx — постоянный отказ (адрес не существует, отклонено политикой). */
const isPermanentSmtpError = (err: unknown): boolean => {
  const code = (err as { responseCode?: unknown })?.responseCode;

  return typeof code === "number" && code >= 500 && code < 600;
};

/**
 * Почта через очередь: `send` ставит задачу `mail.send`, обработчик
 * (`MailSendJob`) рендерит шаблон и отправляет по SMTP с повторами.
 */
@Injectable()
export class MailerService {
  transport: ReturnType<typeof createTransport>;

  /** SMTP настроен; без него письма вне production только пишутся в лог. */
  configured = !!config.email.smtp.host;

  /** Режим production: без SMTP письма не пишутся в лог, а отклоняются. */
  production = isProduction;

  private readonly _from = config.email.smtp.from || config.email.smtp.user;

  constructor(
    @inject(JobQueue) private readonly _jobs: JobQueue,
    @inject(MailRenderer) private readonly _renderer: MailRenderer,
  ) {
    const { host, port, secure, user, pass } = config.email.smtp;

    this.transport = createTransport({
      host,
      port,
      secure: secure ?? port === 465,
      auth: user ? { user, pass } : undefined,
    });
  }

  /**
   * Поставить письмо в очередь. В транзакции вызывающего передайте
   * `manager` — задача появится только вместе с его изменениями.
   * В production без SMTP — `MAIL_NOT_CONFIGURED` (503) сразу, без задачи.
   */
  async send<T extends TMailTemplate>(
    template: T,
    to: string,
    data: IMailTemplateData[T],
    options: ISendMailOptions = {},
  ): Promise<void> {
    if (!this.configured && this.production) {
      throw MailError.NOT_CONFIGURED();
    }

    const job: IMailSendJobData<T> = {
      template,
      to,
      data,
      locale: resolveMailLocale(options.locale),
    };

    await this._jobs.enqueue(MAIL_SEND_QUEUE, job, {
      manager: options.manager,
    });
  }

  /** Письмо с одноразовым кодом подтверждения email. */
  sendCodeMail = (email: string, code: string, options?: ISendMailOptions) =>
    this.send("otp-code", email, { code }, options);

  /** Письмо со ссылкой сброса пароля (`config.auth.resetPassword.webUrl`). */
  sendResetPasswordMail = (
    email: string,
    token: string,
    options?: ISendMailOptions,
  ) =>
    this.send(
      "reset-password",
      email,
      {
        resetLink: config.auth.resetPassword.webUrl.replace("{{token}}", token),
      },
      options,
    );

  /**
   * Отрендерить и отправить письмо синхронно. Вызывается только обработчиком
   * `mail.send`; ошибки — `JobError`: сбой SMTP повторяется, постоянный
   * отказ (5xx), неизвестный шаблон и отсутствие SMTP в production — нет.
   * Без SMTP вне production письмо (с данными шаблона) пишется в лог.
   */
  async deliver(job: IMailSendJobData): Promise<void> {
    const locale = resolveMailLocale(job.locale);
    let mail: IRenderedMail;

    try {
      mail = this._renderer.render(job.template, locale, job.data);
    } catch (err) {
      if (err instanceof HttpException) {
        throw new JobError(err.code, err.message, false);
      }

      throw err;
    }

    if (!this.configured) {
      if (this.production) {
        throw new JobError(
          MailError.codes.NOT_CONFIGURED,
          "Отправка почты не настроена",
          false,
        );
      }

      // Строкой, а не объектом: поля вроде `code` логгер маскирует.
      const preview = Object.entries(job.data)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");

      logger.info(
        { to: job.to, template: job.template, locale, preview },
        "[Mailer] dev: SMTP не настроен — письмо не отправлено",
      );

      return;
    }

    try {
      await this.transport.sendMail({
        from: this._from,
        to: job.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    } catch (err) {
      const permanent = isPermanentSmtpError(err);

      logger.error(
        { err, template: job.template, permanent },
        "[Mailer] SMTP error",
      );

      throw new JobError(
        MailError.codes.UNAVAILABLE,
        "Почтовый сервис недоступен",
        !permanent,
      );
    }
  }
}
