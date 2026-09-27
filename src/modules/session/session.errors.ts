import { defineErrors } from "../../core";

/** Доменные ошибки сессий (`SESSION_*`). */
export const SessionError = defineErrors("SESSION", {
  NOT_FOUND: { status: 404, message: "Сессия не найдена" },
  FORBIDDEN: { status: 403, message: "Нет доступа к этой сессии" },
  INVALID: { status: 401, message: "Сессия не найдена или завершена" },
  EXPIRED: { status: 401, message: "Сессия истекла" },
  REFRESH_REUSED: {
    status: 401,
    message: "Refresh-токен уже использован: сессия завершена",
  },
});
