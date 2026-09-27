import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_FORWARD_*`. */
export const WgForwardError = defineErrors("WG_FORWARD", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Проброс не найден",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Проброс с таким названием уже есть",
  },
  PORT_TAKEN: {
    status: HttpStatus.CONFLICT,
    message:
      "Порт на релее уже занят: другим пробросом, интерфейсом, точкой подключения или процессом на хосте",
  },
  TARGET_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: "Нужна цель: нода или адрес",
  },
  IPIP_NEEDS_NODE: {
    status: HttpStatus.BAD_REQUEST,
    message:
      "Путь через туннель требует ноду-цель с агентом: она держит свой конец туннеля",
  },
  TARGET_IS_RELAY: {
    status: HttpStatus.CONFLICT,
    message: "Релей и цель — одна и та же нода",
  },
  NO_DIRECT_ADDRESS: {
    status: HttpStatus.BAD_REQUEST,
    message:
      "Для прямого пути нужен адрес цели: укажите targetHost или publicHost ноды-цели",
  },
});
