import { definePermissions } from "../permission";

/** Права модуля пользователей. */
export const UserPermissions = definePermissions("user", {
  /** Просмотр пользователей и их профилей. */
  VIEW: "user:view",
  /** Редактирование, удаление пользователей и назначение привилегий. */
  MANAGE: "user:manage",
});
