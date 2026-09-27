import { defineErrors } from "../../core";

/** Ошибки токена сброса пароля (`AUTH_RESET_*`: часть сценария входа). */
export const ResetPasswordError = defineErrors("AUTH_RESET", {
  TOKEN_INVALID: {
    status: 400,
    message: "Неверный или просроченный токен. Запросите сброс пароля заново.",
  },
});
