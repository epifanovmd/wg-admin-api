import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_AGENT_*`. */
export const WgAgentError = defineErrors("WG_AGENT", {
  BINARY_NOT_BUILT: {
    status: HttpStatus.NOT_FOUND,
    message: "Агент для этой архитектуры не собран на бэкенде",
  },
  LINK_MESSAGE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: "Неверное сообщение канала агента",
  },
});
