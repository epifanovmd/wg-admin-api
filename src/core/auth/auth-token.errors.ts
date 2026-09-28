import { defineErrors } from "../http";

/** Ошибки проверки токенов и прав (`AUTH_*`): на коды опирается клиент. */
export const AuthTokenError = defineErrors("AUTH", {
  TOKEN_MISSING: { status: 401, message: "Требуется аутентификация" },
  TOKEN_EXPIRED: { status: 401, message: "Срок действия токена истёк" },
  TOKEN_INVALID: { status: 401, message: "Неверный токен" },
  TOKEN_WRONG_SCOPE: {
    status: 401,
    message: "Токен не подходит для этого запроса",
  },
  TOKEN_NO_SESSION: { status: 401, message: "Токен не привязан к сессии" },
  SESSION_REVOKED: { status: 401, message: "Сессия завершена" },
  PRIVILEGES_CHANGED: {
    status: 401,
    message: "Права изменились: обновите токен",
  },
  INSUFFICIENT_ROLE: { status: 403, message: "Недостаточно прав: нужна роль" },
  INSUFFICIENT_PERMISSIONS: {
    status: 403,
    message: "Недостаточно прав",
  },
});
