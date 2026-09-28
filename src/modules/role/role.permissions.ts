import { definePermissions } from "../permission";

/** Права модуля ролей. */
export const RolePermissions = definePermissions(
  "role",
  { key: "role", label: "Роли" },
  {
    VIEW: { name: "role:view", label: "Просмотр" },
    CREATE: { name: "role:create", label: "Создание" },
    UPDATE: { name: "role:update", label: "Изменение прав роли" },
    DELETE: { name: "role:delete", label: "Удаление" },
  },
);
