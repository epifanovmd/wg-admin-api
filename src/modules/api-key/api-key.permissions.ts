import { definePermissions } from "../permission";

/** Права модуля API-ключей; по умолчанию — только у admin (через `*`). */
export const ApiKeyPermissions = definePermissions(
  "apikey",
  { key: "apikey", label: "API-ключи" },
  {
    VIEW: { name: "apikey:view", label: "Просмотр" },
    CREATE: { name: "apikey:create", label: "Выпуск" },
    REVOKE: { name: "apikey:revoke", label: "Отзыв" },
  },
);
