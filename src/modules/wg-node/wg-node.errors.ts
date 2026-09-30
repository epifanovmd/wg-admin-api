import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_NODE_*`. */
export const WgNodeError = defineErrors("WG_NODE", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Нода не найдена",
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Недостаточно прав для работы с нодой",
  },
  USER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь не найден",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Нода с таким названием уже существует",
  },
  HAS_INTERFACES: {
    status: HttpStatus.CONFLICT,
    message: "Сначала удалите WireGuard-интерфейсы ноды",
  },
  AGENT_SCOPE_INVALID: {
    status: HttpStatus.FORBIDDEN,
    message: "Ключ агента не привязан к ноде",
  },
  COMMAND_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Команда не найдена",
  },
  COMMAND_WAIT_TIMEOUT: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: "Агент не ответил на команду вовремя",
  },
  COMMAND_NOT_PENDING: {
    status: HttpStatus.CONFLICT,
    message: "Команда уже завершена",
  },
  AGENT_OFFLINE: {
    status: HttpStatus.CONFLICT,
    message: "Агент ноды не на связи",
  },
});
