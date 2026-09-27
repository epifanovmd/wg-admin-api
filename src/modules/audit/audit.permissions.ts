import { definePermissions } from "../permission";

/** Права модуля аудита. */
export const AuditPermissions = definePermissions("audit", {
  /** Просмотр общего журнала безопасности. */
  VIEW: "audit:view",
});
