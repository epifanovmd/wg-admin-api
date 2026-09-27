import { defineErrors } from "../../core";

/** Доменные ошибки журнала аудита (`AUDIT_*`). */
export const AuditError = defineErrors("AUDIT", {
  INVALID_CURSOR: { status: 400, message: "Некорректный курсор страницы" },
});
