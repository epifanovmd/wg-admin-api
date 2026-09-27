import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля: коды `WG_PEER_*`. */
export const WgPeerError = defineErrors("WG_PEER", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пир не найден",
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Недостаточно прав для работы с пирами",
  },
  NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Пир с таким именем уже есть на интерфейсе",
  },
  PUBLIC_KEY_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Пир с таким публичным ключом уже есть на интерфейсе",
  },
  ADDRESS_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Адрес уже занят другим пиром",
  },
  SUBNET_FULL: {
    status: HttpStatus.CONFLICT,
    message: "В подсети интерфейса нет свободных адресов",
  },
  NO_PRIVATE_KEY: {
    status: HttpStatus.CONFLICT,
    message:
      "Пир создан импортом публичного ключа — конфиг формируется на клиенте",
  },
  ENDPOINT_UNRESOLVED: {
    status: HttpStatus.CONFLICT,
    message:
      "Не задан адрес подключения: укажите точку подключения интерфейса или publicHost ноды",
  },
  USER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь не найден",
  },
  NO_PSK: {
    status: HttpStatus.CONFLICT,
    message: "У пира нет preshared-ключа",
  },
});
