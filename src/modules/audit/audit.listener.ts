import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ApiKeyCreatedEvent, ApiKeyRevokedEvent } from "../api-key";
import {
  AccountLockedEvent,
  LoginFailedEvent,
  TwoFactorDisabledEvent,
  TwoFactorEnabledEvent,
  UserLoggedInEvent,
  UserSignedOutEvent,
} from "../auth";
import { BiometricAddedEvent, BiometricRemovedEvent } from "../biometric";
import { PasskeyAddedEvent, PasskeyRemovedEvent } from "../passkeys";
import { SessionTerminatedEvent, TSessionEndReason } from "../session";
import { ISocketEventListener } from "../socket";
import { PasswordChangedEvent } from "../user";
import { AuditService } from "./audit.service";
import { AuditEventType } from "./audit.types";

/** Завершения, которые уже записаны своим событием (выход). */
const LOGGED_ELSEWHERE = new Set<TSessionEndReason>([
  "sign-out",
  "sign-out-all",
]);

/**
 * События безопасности модулей → журнал аудита. Регистрируется через
 * `asSocketListener` (единый хук подписки на EventBus при старте), запись
 * асинхронна и не тормозит запрос.
 */
@Injectable()
export class AuditListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(AuditService) private readonly _audit: AuditService,
  ) {}

  register(): void {
    const on = this._eventBus.on.bind(this._eventBus);

    on(UserLoggedInEvent, e =>
      this._audit.record({
        type: AuditEventType.LOGIN_SUCCEEDED,
        actorId: e.userId,
        subjectId: e.sessionId,
        ...e.request,
        meta: { method: e.method },
      }),
    );

    on(LoginFailedEvent, e =>
      this._audit.record({
        type: AuditEventType.LOGIN_FAILED,
        actorId: e.userId,
        ...e.request,
        meta: { login: e.login.slice(0, 100), reason: e.reason },
      }),
    );

    on(AccountLockedEvent, e =>
      this._audit.record({
        type: AuditEventType.ACCOUNT_LOCKED,
        actorId: e.userId,
        ...e.request,
        meta: { login: e.login.slice(0, 100), until: e.until.toISOString() },
      }),
    );

    on(TwoFactorEnabledEvent, e =>
      this._audit.record({
        type: AuditEventType.TWO_FACTOR_ENABLED,
        actorId: e.userId,
        ...e.request,
      }),
    );

    on(TwoFactorDisabledEvent, e =>
      this._audit.record({
        type: AuditEventType.TWO_FACTOR_DISABLED,
        actorId: e.userId,
        ...e.request,
      }),
    );

    on(PasswordChangedEvent, e =>
      this._audit.record({
        type:
          e.method === "reset"
            ? AuditEventType.PASSWORD_RESET
            : AuditEventType.PASSWORD_CHANGED,
        actorId: e.userId,
        subjectId: e.currentSessionId ?? null,
      }),
    );

    on(UserSignedOutEvent, e =>
      this._audit.record({
        type:
          e.scope === "all"
            ? AuditEventType.SIGNED_OUT_ALL
            : AuditEventType.SIGNED_OUT,
        actorId: e.userId,
        subjectId: e.sessionId,
        ...e.request,
      }),
    );

    on(SessionTerminatedEvent, async e => {
      if (LOGGED_ELSEWHERE.has(e.reason)) return;

      await this._audit.record({
        type: AuditEventType.SESSION_TERMINATED,
        actorId: e.userId,
        subjectId: e.sessionId,
        meta: { reason: e.reason },
      });
    });

    on(PasskeyAddedEvent, e =>
      this._audit.record({
        type: AuditEventType.PASSKEY_ADDED,
        actorId: e.userId,
        subjectId: e.passkeyId,
      }),
    );

    on(PasskeyRemovedEvent, e =>
      this._audit.record({
        type: AuditEventType.PASSKEY_REMOVED,
        actorId: e.userId,
        subjectId: e.passkeyId,
      }),
    );

    on(BiometricAddedEvent, e =>
      this._audit.record({
        type: AuditEventType.BIOMETRIC_ADDED,
        actorId: e.userId,
        subjectId: e.deviceId,
        meta: { deviceName: e.deviceName },
      }),
    );

    on(BiometricRemovedEvent, e =>
      this._audit.record({
        type: AuditEventType.BIOMETRIC_REMOVED,
        actorId: e.userId,
        subjectId: e.deviceId,
      }),
    );

    on(ApiKeyCreatedEvent, e =>
      this._audit.record({
        type: AuditEventType.API_KEY_CREATED,
        actorId: e.ownerId,
        subjectId: e.apiKeyId,
        meta: { name: e.name, scopes: e.scopes },
      }),
    );

    on(ApiKeyRevokedEvent, e =>
      this._audit.record({
        type: AuditEventType.API_KEY_REVOKED,
        actorId: e.revokedBy ?? null,
        subjectId: e.apiKeyId,
      }),
    );
  }
}
