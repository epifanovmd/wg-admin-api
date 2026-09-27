import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки почты: коды `MAIL_*`. */
export const MailError = defineErrors("MAIL", {
  NOT_CONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "Отправка почты не настроена",
  },
  UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "Почтовый сервис недоступен",
  },
  TEMPLATE_NOT_FOUND: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Шаблон письма не найден",
  },
});
