import { defineErrors, HttpStatus } from "../../core";

/** Доменные ошибки профилей: коды `PROFILE_*`. */
export const ProfileError = defineErrors("PROFILE", {
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Профиль не найден" },
});
