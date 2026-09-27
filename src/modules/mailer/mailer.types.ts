import type { EntityManager } from "typeorm";

/** Очередь отправки писем. */
export const MAIL_SEND_QUEUE = "mail.send";

/** Языки писем: у каждого — полный набор шаблонов в `templates/mail/<locale>/`. */
export const MAIL_LOCALES = ["ru", "en"] as const;

export type TMailLocale = (typeof MAIL_LOCALES)[number];

export const DEFAULT_MAIL_LOCALE: TMailLocale = "ru";

/**
 * Данные каждого шаблона: имя шаблона → переменные. Модуль со своим письмом
 * дополняет интерфейс (`declare module "../mailer/mailer.types"`) и кладёт файлы
 * шаблона во все локали — тест полноты проверит наборы.
 */
export interface IMailTemplateData {
  "otp-code": { code: string };
  "reset-password": { resetLink: string };
  "email-change-code": {
    code: string;
    newEmail: string;
    expiresInMinutes: number;
  };
  "email-change-notice": { newEmail: string };
}

export type TMailTemplate = keyof IMailTemplateData;

export interface ISendMailOptions {
  /** Язык письма; `null`, неизвестный или не задан — `DEFAULT_MAIL_LOCALE`. */
  locale?: string | null;
  /** Транзакция вызывающего: задача создаётся атомарно с его изменениями. */
  manager?: EntityManager;
}

/** Данные задачи `mail.send`. */
export interface IMailSendJobData<T extends TMailTemplate = TMailTemplate> {
  template: T;
  to: string;
  data: IMailTemplateData[T];
  locale: TMailLocale;
}

export interface IRenderedMail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Язык письма из произвольной строки (`profile.locale`, `Accept-Language`):
 * `en-US` → `en`; неизвестный — язык по умолчанию.
 */
export const resolveMailLocale = (value?: string | null): TMailLocale => {
  const base = value?.trim().toLowerCase().split(/[-_]/)[0];

  return (MAIL_LOCALES as readonly string[]).includes(base ?? "")
    ? (base as TMailLocale)
    : DEFAULT_MAIL_LOCALE;
};
