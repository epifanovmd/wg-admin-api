import { defineErrors } from "../../core";

/** Доменные ошибки одноразовых кодов (`OTP_*`). */
export const OtpError = defineErrors("OTP", {
  INVALID_CODE: {
    status: 400,
    message: "Неверный код. Пожалуйста, повторите попытку.",
  },
  CODE_EXPIRED: {
    status: 400,
    message: "Срок действия кода истек. Пожалуйста, запросите новый код.",
  },
  ATTEMPTS_EXHAUSTED: {
    status: 400,
    message: "Превышено число попыток. Пожалуйста, запросите новый код.",
  },
  RESEND_COOLDOWN: {
    status: 429,
    message: "Код уже отправлен. Повторная отправка возможна через минуту.",
  },
});
