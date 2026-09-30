import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_ENDPOINT_*`. */
export const WgEndpointError = defineErrors("WG_ENDPOINT", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Точка подключения не найдена",
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Недостаточно прав для работы с точкой подключения",
  },
  USER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь не найден",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Точка подключения с таким названием уже существует",
  },
  IN_USE: {
    status: HttpStatus.CONFLICT,
    message: "Точка подключения используется интерфейсами",
  },
  RELAY_NODE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: "Для режима relay нужна релей-нода",
  },
  RELAY_NODE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Релей-нода не найдена",
  },
  RELAY_IS_TARGET: {
    status: HttpStatus.CONFLICT,
    message:
      "Релей-нода не может обслуживать точку для собственных интерфейсов — выберите другую ноду",
  },
  RELAY_PORT_CONFLICT: {
    status: HttpStatus.CONFLICT,
    message:
      "На новой релей-ноде порты интерфейсов точки уже заняты — смените порты или релей",
  },
  TUNNEL_CAPACITY_EXCEEDED: {
    status: HttpStatus.CONFLICT,
    message: "Подсеть туннелей исчерпана — расширьте WG_RELAY_TUNNEL_CIDR",
  },
});
