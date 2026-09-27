import { ALL_PERMISSIONS } from "../../core/auth/superuser";

/**
 * Справочник известных прав (совместимость). В БД права хранятся как строки —
 * новые добавляются через API без деплоя. Формат: "domain:action" или
 * "domain:*" (wildcard).
 *
 * Новый модуль объявляет свои права сам — `definePermissions` из
 * `permission.registry.ts`; этот файл при этом не правится.
 */
export const Permissions = {
  // ── Superadmin ────────────────────────────────────────────────────────────
  /** Предоставляет доступ ко всему. Эквивалентно роли ADMIN. */
  ALL: ALL_PERMISSIONS,

  // ── User management ───────────────────────────────────────────────────────
  /** Просмотр списка пользователей и их профилей */
  USER_VIEW: "user:view",
  /** Создание, редактирование, блокировка пользователей и назначение ролей */
  USER_MANAGE: "user:manage",

  // ── Role management ───────────────────────────────────────────────────────
  ROLE_VIEW: "role:view",
  ROLE_MANAGE: "role:manage",

  // ── Profile ───────────────────────────────────────────────────────────────
  PROFILE_VIEW: "profile:view",
  PROFILE_MANAGE: "profile:manage",

  // ── Платформа (по умолчанию — только у admin через «*») ─────────────────
  APIKEY_MANAGE: "apikey:manage",
  AUDIT_VIEW: "audit:view",
} as const;

/** Тип для предопределённых permissions (автодополнение в IDE). */
export type KnownPermission = (typeof Permissions)[keyof typeof Permissions];

/** Permission — произвольная строка; предопределённые значения дают автодополнение. */
export type TPermission = KnownPermission | (string & {});

/**
 * Имя права в теле запроса API (`домен:действие`). Обычная строка: `TPermission`
 * с `string & {}` tsoa проверить не может. Известные права — `Permissions`.
 * @minLength 1
 * @maxLength 100
 */
export type PermissionName = string;
