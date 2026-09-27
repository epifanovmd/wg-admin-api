/** Типы событий безопасности в журнале (`домен.действие`). */
export const AuditEventType = {
  LOGIN_SUCCEEDED: "auth.login.succeeded",
  LOGIN_FAILED: "auth.login.failed",
  ACCOUNT_LOCKED: "auth.account.locked",
  TWO_FACTOR_ENABLED: "auth.2fa.enabled",
  TWO_FACTOR_DISABLED: "auth.2fa.disabled",
  PASSWORD_CHANGED: "auth.password.changed",
  PASSWORD_RESET: "auth.password.reset",
  SIGNED_OUT: "auth.signed-out",
  SIGNED_OUT_ALL: "auth.signed-out-all",
  SESSION_TERMINATED: "session.terminated",
  PASSKEY_ADDED: "passkey.added",
  PASSKEY_REMOVED: "passkey.removed",
  API_KEY_CREATED: "api-key.created",
  API_KEY_REVOKED: "api-key.revoked",
} as const;

export type TAuditEventType =
  (typeof AuditEventType)[keyof typeof AuditEventType];

/** Сколько дней хранится журнал; старше — удаляет cron-задача. */
export const AUDIT_RETENTION_DAYS = 180;

/** Запись журнала до сохранения. */
export interface IAuditEntry {
  type: TAuditEventType;
  /** Чей это журнал: пользователь, совершивший действие или атакованный. */
  actorId?: string | null;
  /** Объект действия: сессия, passkey, устройство, ключ. */
  subjectId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/** Фильтр списка событий. */
export interface IAuditFilter {
  actorId?: string;
  type?: string;
}
