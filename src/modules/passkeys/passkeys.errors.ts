import { defineErrors } from "../../core";

/** Доменные ошибки passkeys (`PASSKEY_*`). */
export const PasskeyError = defineErrors("PASSKEY", {
  NOT_FOUND: { status: 404, message: "Passkey не найден" },
  ALREADY_REGISTERED: {
    status: 409,
    message: "Этот passkey уже зарегистрирован",
  },
  LOGIN_REQUIRED: {
    status: 400,
    message: "Для passkey у пользователя должен быть email или телефон",
  },
  CHALLENGE_MISSING: {
    status: 400,
    message:
      "Challenge не найден или истёк. Сначала вызовите generate-registration-options.",
  },
  REGISTRATION_FAILED: {
    status: 400,
    message: "Ошибка верификации регистрации",
  },
  AUTH_FAILED: { status: 401, message: "Не удалось войти по passkey" },
});
