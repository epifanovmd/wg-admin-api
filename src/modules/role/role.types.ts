import { SUPERUSER_ROLE } from "../../core/auth/superuser";

/**
 * Предопределённые роли.
 * В БД хранятся как строки — можно добавлять новые через API без деплоя.
 */
export const Roles = {
  ADMIN: SUPERUSER_ROLE,
  USER: "user",
  GUEST: "guest",
} as const;

/** Тип для предопределённых ролей (автодополнение в IDE). */
export type KnownRole = (typeof Roles)[keyof typeof Roles];

/** Роль — произвольная строка; предопределённые значения дают автодополнение. */
export type TRole = KnownRole | (string & {});

/**
 * Имя роли в теле запроса API. Обычная строка: `TRole` с `string & {}`
 * tsoa проверить не может и отклоняет любое значение. Известные роли — `Roles`.
 * @minLength 1
 * @maxLength 100
 */
export type RoleName = string;
