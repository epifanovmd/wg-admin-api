import { definePermissions } from "../permission";

/** Права модуля пользователей. */
export const UserPermissions = definePermissions(
  "user",
  { key: "user", label: "Пользователи" },
  {
    VIEW: { name: "user:view", label: "Просмотр" },
    UPDATE: { name: "user:update", label: "Изменение контактов" },
    DELETE: { name: "user:delete", label: "Удаление" },
    PRIVILEGES: { name: "user:privileges", label: "Назначение ролей и прав" },
  },
);
