import { definePermissions } from "../permission";

/** Права модуля аудита. */
export const AuditPermissions = definePermissions(
  "audit",
  { key: "audit", label: "Журнал безопасности" },
  {
    VIEW: { name: "audit:view", label: "Просмотр журнала всех пользователей" },
  },
);
