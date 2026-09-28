/**
 * Право — строка `domain:action` (или `domain:*` — wildcard). Модуль объявляет
 * свои права сам через `definePermissions`; каталог с подписями отдаёт
 * `GET /api/v1/permissions`.
 */
export type TPermission = string;

/**
 * Имя права в теле запроса API (`домен:действие`).
 * @minLength 1
 * @maxLength 100
 */
export type PermissionName = string;
