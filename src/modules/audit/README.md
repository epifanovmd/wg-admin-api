# Модуль Audit

Журнал событий безопасности: входы (успешные и неудачные), блокировки, 2FA, смена
и сброс пароля, завершение сессий, выход, passkeys и биометрия, выпуск и отзыв API-ключей. Пользователь видит
свой журнал, администратор с правом `audit:view` — все события.

## Структура файлов

```
src/modules/audit/
├── audit.module.ts         # провайдеры, listeners, политика комнаты audit
├── audit-event.entity.ts   # AuditEvent
├── audit.repository.ts     # лента с курсором, удаление старых
├── audit.service.ts        # record (без исключений, эмитит AuditRecordedEvent), list, cleanup
├── audit.listener.ts       # EventBus → журнал
├── audit-feed.listener.ts  # AuditFeedListener: новая запись → сокет
├── audit.socket-events.ts  # audit:created в контракте сокета
├── events/                 # AuditRecordedEvent
├── audit.controller.ts     # 2 эндпоинта
├── audit-cleanup.job.ts    # AuditCleanupJob (cron)
├── audit.dto.ts            # AuditEventDto
├── audit.types.ts          # AuditEventType, AUDIT_RETENTION_DAYS
├── audit.errors.ts         # AuditError (AUDIT_*)
├── audit.permissions.ts    # AuditPermissions (audit:view)
├── validation/             # Zod-схемы query
└── *.test.ts
```

## Сущность `AuditEvent` (таблица `audit_events`)

| Поле        | Тип                      | Описание                                             |
| ----------- | ------------------------ | ---------------------------------------------------- |
| `id`        | `uuid` (PK)              |                                                      |
| `type`      | `varchar(64)`            | `AuditEventType`, например `auth.login.failed`       |
| `actorId`   | `uuid`, nullable         | Чей журнал: кто действовал или чей аккаунт атакован  |
| `subjectId` | `varchar(255)`, nullable | Объект: сессия, passkey, устройство, API-ключ        |
| `ip`        | `varchar(45)`, nullable  |                                                      |
| `userAgent` | `varchar(500)`, nullable |                                                      |
| `meta`      | `jsonb`                  | Подробности: `method`, `reason`, `login`, `until`, … |
| `createdAt` | `timestamptz(3)`         | Миллисекунды — для курсора ленты                     |

Индексы: `IDX_AUDIT_EVENTS_ACTOR_CREATED (actor_id, created_at)`,
`IDX_AUDIT_EVENTS_TYPE_CREATED (type, created_at)`, `IDX_AUDIT_EVENTS_CREATED_AT`.
Внешнего ключа на пользователя нет: журнал переживает удаление аккаунта.

## Эндпоинты (`/api/v1/audit`)

| Метод | Путь  | Security                     | Query                                    | Ответ                           |
| ----- | ----- | ---------------------------- | ---------------------------------------- | ------------------------------- |
| GET   | `/my` | jwt                          | `cursor?`, `limit?` (≤ 100), `type?`     | `ICursorPageDto<AuditEventDto>` |
| GET   | `/`   | jwt, `permission:audit:view` | `cursor?`, `limit?`, `type?`, `actorId?` | `ICursorPageDto<AuditEventDto>` |

Лента — новые первыми, курсор `(createdAt, id)`; битый курсор — 400 `AUDIT_INVALID_CURSOR`.

## События → записи (`AuditListener`)

| Событие (модуль)                          | Тип записи                                                      |
| ----------------------------------------- | --------------------------------------------------------------- |
| `UserLoggedInEvent` (auth)                | `auth.login.succeeded` (`meta.method`)                          |
| `LoginFailedEvent` (auth)                 | `auth.login.failed` (`meta.login`, `reason`)                    |
| `AccountLockedEvent` (auth)               | `auth.account.locked` (`meta.until`)                            |
| `TwoFactorEnabled/DisabledEvent` (auth)   | `auth.2fa.enabled` / `auth.2fa.disabled`                        |
| `PasswordChangedEvent` (user)             | `auth.password.changed` / `auth.password.reset`                 |
| `UserSignedOutEvent` (auth)               | `auth.signed-out` / `auth.signed-out-all`                       |
| `SessionTerminatedEvent` (session)        | `session.terminated` (`meta.reason`; кроме завершений выходом)  |
| `PasskeyAdded/RemovedEvent` (passkeys)    | `passkey.added` / `passkey.removed`                             |
| `BiometricAdded/RemovedEvent` (biometric) | `biometric.added` / `biometric.removed`                         |
| `ApiKeyCreatedEvent` (api-key)            | `api-key.created` (`actorId` — владелец, `meta.name`, `scopes`) |
| `ApiKeyRevokedEvent` (api-key)            | `api-key.revoked` (`actorId` — кто отозвал)                     |

**Запись напрямую, не через очередь.** `EventBus.emit` не ждёт асинхронных
обработчиков, поэтому запрос не тормозит; запись — один `INSERT`, а постановка в
очередь стоила бы такой же вставки в таблицу pg-boss плюс работу воркера. Ошибка БД
ловится в `AuditService.record` и пишется в лог — сценарий, породивший событие, не
ломается. Цена: при недоступной БД событие теряется (как и основная операция).

## Сокет

`AuditService.record` после вставки эмитит `AuditRecordedEvent(dto)`. `AuditFeedListener`
шлёт `audit:created` (`AuditEventDto`) в комнату общего журнала `audit` (`AUDIT_ROOM`,
`permissionRoomPolicy`, право `audit:view`) и автору записи (`toUser(actorId)`) — лента
«Моя активность».

## Задачи

`AuditCleanupJob` — очередь `audit.cleanup`, cron `30 3 * * *`: удаляет события старше
`AUDIT_RETENTION_DAYS = 180` дней.

## Права

`audit:view` — просмотр общего журнала (суперпользователь проходит всегда). Объявлено
в `audit.permissions.ts` через `definePermissions` модуля permission — засев ролей
подхватывает его автоматически.
