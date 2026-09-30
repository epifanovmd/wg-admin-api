import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_SOCKS_*`. */
export const WgSocksError = defineErrors("WG_SOCKS", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Прокси-сервис не найден",
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Недостаточно прав для работы с прокси",
  },
  OWNER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь не найден",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Прокси-сервис с таким названием уже есть",
  },
  PORT_TAKEN: {
    status: HttpStatus.CONFLICT,
    message:
      "TCP-порт на ноде уже занят: пробросом, другим прокси или процессом на хосте",
  },
  USER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь прокси не найден",
  },
  USERNAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Пользователь с таким именем в этом прокси уже есть",
  },
  CLIENT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Клиентский сертификат не найден",
  },
  NO_CLIENT_HOST: {
    status: HttpStatus.CONFLICT,
    message: "Не задан адрес для клиентов, и у ноды нет публичного адреса",
  },
});
