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
  NO_AGENT: {
    status: HttpStatus.CONFLICT,
    message: "На ноде не установлен агент",
  },
  AGENT_BOUND: {
    status: HttpStatus.CONFLICT,
    message: "Агент уже привязан к другой ноде",
  },
  AGENT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Агент не найден",
  },
  WORKER_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    message: "Воркер агента не выполнил запрос",
  },
});
