import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_IFACE_*`. */
export const WgInterfaceError = defineErrors("WG_IFACE", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Интерфейс не найден",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Интерфейс с таким именем уже есть на ноде",
  },
  PORT_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Порт уже занят другим интерфейсом ноды",
  },
  ENDPOINT_PORT_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Порт на точке подключения уже занят другим интерфейсом",
  },
  ENDPOINT_RELAY_IS_NODE: {
    status: HttpStatus.CONFLICT,
    message:
      "Релей точки подключения — эта же нода: выберите точку с другой релей-нодой",
  },
  RELAY_PORT_TAKEN: {
    status: HttpStatus.CONFLICT,
    message:
      "Порт на релей-ноде точки уже занят: её интерфейсом, другой точкой или включённым пробросом (выключите или удалите его)",
  },
  RELAY_PORT_BUSY: {
    status: HttpStatus.CONFLICT,
    message:
      "Порт на релей-ноде занят другим процессом на хосте (по отчёту агента) — выберите другой порт точки",
  },
  PORT_FORWARDED: {
    status: HttpStatus.CONFLICT,
    message: "Порт на этой ноде занят пробросом релея",
  },
  HAS_PEERS: {
    status: HttpStatus.CONFLICT,
    message: "Сначала удалите пиров интерфейса",
  },
  CUSTOM_HOOKS_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Нет права задавать произвольные PostUp/PostDown",
  },
  MOVE_TO_REPLICA: {
    status: HttpStatus.CONFLICT,
    message: "На этой ноде уже есть реплика интерфейса — сначала уберите её",
  },
  REPLICA_IS_PRIMARY: {
    status: HttpStatus.BAD_REQUEST,
    message: "Это основная нода интерфейса",
  },
  REPLICA_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: "Реплика на этой ноде уже есть",
  },
  REPLICA_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Реплики на этой ноде нет",
  },
  ACTIVE_REPLICA_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: "Закрепить можно только основную ноду или ноду реплики",
  },
  MOVE_SAME_NODE: {
    status: HttpStatus.BAD_REQUEST,
    message: "Интерфейс уже на этой ноде",
  },
  NODE_CHANGE_FORBIDDEN: {
    status: HttpStatus.BAD_REQUEST,
    message: "Перенос интерфейса на другую ноду не поддерживается",
  },
});
