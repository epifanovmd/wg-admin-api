import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки пользователей: коды `USER_*`. */
export const UserError = defineErrors("USER", {
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Пользователь не найден",
  },
  ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: "Пользователь уже существует",
  },
  EMAIL_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Email уже используется",
  },
  PHONE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Телефон уже используется",
  },
  USERNAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: "Этот username уже занят",
  },
  USERNAME_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: "Username: 5-32 символа, допустимы a-z, 0-9, _",
  },
  DEFAULT_ROLE_MISSING: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Роль по умолчанию не найдена",
  },
  ROLES_NOT_FOUND: {
    status: HttpStatus.BAD_REQUEST,
    message: "Роли не найдены",
  },
  PERMISSIONS_NOT_FOUND: {
    status: HttpStatus.BAD_REQUEST,
    message: "Разрешения не найдены",
  },
  OWN_PRIVILEGES: {
    status: HttpStatus.FORBIDDEN,
    message: "Нельзя менять собственные привилегии",
  },
  SUPERUSER_ONLY: {
    status: HttpStatus.FORBIDDEN,
    message:
      "Выдавать права суперпользователя и менять их может только суперпользователь",
  },
  SELF_DELETE_VIA_ADMIN: {
    status: HttpStatus.FORBIDDEN,
    message: "Собственный аккаунт удаляется через my/delete",
  },
  SUPERUSER_EDIT: {
    status: HttpStatus.FORBIDDEN,
    message: "Данные суперпользователя меняет только суперпользователь",
  },
  SUPERUSER_DELETE: {
    status: HttpStatus.FORBIDDEN,
    message: "Нельзя удалить суперпользователя",
  },
  WRONG_PASSWORD: { status: HttpStatus.FORBIDDEN, message: "Неверный пароль" },
  WRONG_CURRENT_PASSWORD: {
    status: HttpStatus.FORBIDDEN,
    message: "Неверный текущий пароль",
  },
  EMAIL_ALREADY_VERIFIED: {
    status: HttpStatus.CONFLICT,
    message: "Email уже подтвержден",
  },
  EMAIL_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    message: "У пользователя отсутствует email",
  },
  VERIFY_EMAIL_TOO_FREQUENT: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: "Код уже отправлен, повторите запрос позже",
  },
  EMAIL_CHANGE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "Запрос на смену email не найден",
  },
  EMAIL_CHANGE_EXPIRED: {
    status: HttpStatus.GONE,
    message: "Срок действия кода истёк, запросите смену email заново",
  },
  EMAIL_CHANGE_INVALID_CODE: {
    status: HttpStatus.BAD_REQUEST,
    message: "Неверный код подтверждения",
  },
  EMAIL_CHANGE_ATTEMPTS_EXCEEDED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: "Превышено число попыток, запросите смену email заново",
  },
  EMAIL_CHANGE_TOO_FREQUENT: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: "Смену email можно запросить повторно через минуту",
  },
});
