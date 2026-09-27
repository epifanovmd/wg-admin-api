import { defineErrors } from "../../core";

/** Доменные ошибки входа, регистрации и 2FA (`AUTH_*`). */
export const AuthError = defineErrors("AUTH", {
  INVALID_CREDENTIALS: { status: 401, message: "Не верный логин или пароль" },
  USER_EXISTS: {
    status: 409,
    message: "Пользователь с таким email или телефоном уже существует",
  },
  LOGIN_REQUIRED: {
    status: 400,
    message: "Необходимо указать либо email, либо телефон, а также пароль.",
  },
  ACCOUNT_LOCKED: {
    status: 429,
    message:
      "Слишком много неудачных попыток входа. Вход временно заблокирован.",
  },
  TOO_MANY_ATTEMPTS: {
    status: 429,
    message: "Слишком много неудачных попыток. Попробуйте позже.",
  },
  WRONG_PASSWORD: { status: 403, message: "Неверный текущий пароль" },
  TWO_FACTOR_ALREADY_ENABLED: { status: 400, message: "2FA уже включена" },
  TWO_FACTOR_NOT_ENABLED: { status: 400, message: "2FA не включена" },
  TWO_FACTOR_WRONG_PASSWORD: { status: 403, message: "Неверный пароль 2FA" },
  TWO_FACTOR_INVALID: { status: 401, message: "Неверный пароль 2FA" },
  TWO_FACTOR_TOKEN_USED: { status: 401, message: "Токен 2FA уже использован" },
  REFRESH_TOKEN_MISSING: { status: 401, message: "Токен отсутствует" },
});
