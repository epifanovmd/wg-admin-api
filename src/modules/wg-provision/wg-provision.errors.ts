import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_PROVISION_*`. */
export const WgProvisionError = defineErrors("WG_PROVISION", {
  AUTH_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: "Нужен SSH-ключ или пароль",
  },
  BACKEND_URL_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message:
      "Не задан публичный URL бэкенда: укажите backendUrl или APP_PUBLIC_URL",
  },
  ALREADY_RUNNING: {
    status: HttpStatus.CONFLICT,
    message: "Установка на эту ноду уже идёт",
  },
});
