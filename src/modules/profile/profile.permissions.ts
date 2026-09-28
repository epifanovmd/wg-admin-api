import { definePermissions } from "../permission";

/** Права модуля профилей (чужие профили; свой доступен всегда). */
export const ProfilePermissions = definePermissions(
  "profile",
  { key: "profile", label: "Профили" },
  {
    VIEW: { name: "profile:view", label: "Просмотр" },
    UPDATE: { name: "profile:update", label: "Изменение" },
    DELETE: { name: "profile:delete", label: "Удаление" },
  },
);
