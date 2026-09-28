import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки модуля ролей: коды `ROLE_*`. */
export const RoleError = defineErrors("ROLE", {
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Роль не найдена" },
  ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: "Роль с таким именем уже существует",
  },
  SUPERUSER_ONLY: {
    status: HttpStatus.FORBIDDEN,
    message:
      "Изменять роль admin и выдавать право «*» может только суперпользователь",
  },
  SYSTEM_ROLE: {
    status: HttpStatus.CONFLICT,
    message: "Системную роль удалить нельзя",
  },
  OWN_ROLE: {
    status: HttpStatus.FORBIDDEN,
    message: "Нельзя менять права собственной роли",
  },
});
