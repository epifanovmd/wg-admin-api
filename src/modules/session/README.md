# Модуль Session

Сессии устройств пользователя: создание при входе, ротация refresh-токена,
завершение с немедленным отзывом access-токена, лимит и фоновая очистка.
Refresh-токен хранится только sha256-хешем.

## Структура файлов

```
src/modules/session/
├── session.module.ts             # @Module: entity, провайдеры, cron-задача
├── session.entity.ts
├── session.repository.ts
├── session.service.ts
├── session.controller.ts         # 3 эндпоинта
├── session.listener.ts           # EventBus → завершение сессий, отзыв токенов, разрыв сокетов
├── session-cleanup.job.ts        # SessionCleanupJob (cron, очередь session.cleanup)
├── session.errors.ts             # SessionError (SESSION_*)
├── session.dto.ts                # SessionDto
├── session.types.ts              # IDeviceInfo, TSessionEndReason
├── events/session-terminated.event.ts
└── *.test.ts
```

## Сущность `Session` (таблица `sessions`)

| Поле               | Тип            | Описание                           |
| ------------------ | -------------- | ---------------------------------- |
| `id`               | `uuid` (PK)    | Он же `sessionId` в JWT            |
| `userId`           | `uuid`         | FK → users (`CASCADE`)             |
| `refreshTokenHash` | `varchar(64)`  | sha256 действующего refresh-токена |
| `expiresAt`        | `timestamptz`  | `exp` действующего refresh-токена  |
| `deviceName`       | `varchar(200)` | nullable                           |
| `deviceType`       | `varchar(50)`  | nullable                           |
| `ip`               | `varchar(45)`  | nullable                           |
| `userAgent`        | `varchar(500)` | nullable                           |
| `lastActiveAt`     | `timestamptz`  | Обновляется при refresh            |
| `createdAt`        | `timestamptz`  |                                    |

Индексы: `IDX_SESSIONS_USER`, `IDX_SESSIONS_REFRESH_TOKEN_HASH` (unique),
`IDX_SESSIONS_EXPIRES_AT`.

## Эндпоинты (`/api/v1/session`, все `jwt`)

| Метод  | Путь                | Описание                                                                                      |
| ------ | ------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/?offset&limit`    | Действующие сессии, `IPaginatedDto<SessionDto>` (последние активные — первыми; limit ≤ 100)   |
| DELETE | `/{id}`             | 204. Завершить свою сессию; `SESSION_NOT_FOUND` (404), `SESSION_FORBIDDEN` (403); `id` — UUID |
| POST   | `/terminate-others` | 204. Завершить все, кроме текущей                                                             |

## `SessionService`

| Метод                                                   | Описание                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `createAuthenticatedSession(subject, deviceInfo)`       | `subject: TokenSubject` (ядро); выдаёт токены, сохраняет хеш и срок refresh; сверх `MAX_ACTIVE_SESSIONS` (10) — `evicted`       |
| `validateRefresh(decoded, token)`                       | Сессия по `decoded.sessionId`, владелец, срок (`SESSION_EXPIRED`); хеш не совпал → `SESSION_REFRESH_REUSED`, сессия завершается |
| `rotateRefreshToken(session, oldToken, tokens)`         | `UPDATE … WHERE id AND refresh_token_hash = old`; проигранная гонка → `SESSION_REFRESH_REUSED`                                  |
| `getSessions(userId, offset?, limit?)`                  | Страница действующих сессий                                                                                                     |
| `terminateSession(sessionId, userId, reason?)`          | Завершить свою сессию                                                                                                           |
| `terminateAllOther(userId, currentSessionId, reason?)`  | Все, кроме текущей                                                                                                              |
| `terminateAllByUser(userId, exceptSessionId?, reason?)` | Все сессии пользователя, кроме указанной                                                                                        |
| `cleanupExpired()`                                      | Удалить просроченные                                                                                                            |

Любое завершение: удаляет записи → **сразу отзывает access-токены**
(`TokenService.revokeSessions`, ошибка отзыва — в лог) → публикует
`SessionTerminatedEvent(sessionId, userId, reason)` на каждую сессию.
`reason`: `sign-out`, `sign-out-all`, `terminated`, `others-terminated`, `evicted`,
`expired`, `refresh-reuse`, `password-changed`.

## Отзыв access-токенов

Список отозванных — в ядре (`core/auth/session-revocation.ts`): Redis
`revoked:session:<id>` с TTL = срок access-токена (без Redis — память процесса).
`TokenService.verify` проверяет его одной командой `MGET` на запрос (с локальным
кэшем ответа на 1 с): завершённая сессия получает 401 `AUTH_SESSION_REVOKED` сразу на
этой реплике и не позже чем через 1 с — на остальных. Удаление пользователя отзывает
все его токены (`revoked:user:<id>`, токены с `iat` не позже отметки). Смена прав
(`TokenService.markPrivilegesChanged`) пишет `privileges:changed:<userId>` (мс):
токены, выданные не позже (по claim `pat` — момент выдачи в мс), получают 401
`AUTH_PRIVILEGES_CHANGED`; клиент обновляет токен refresh-токеном, сессия остаётся.

## Фоновая очистка

`SessionCleanupJob` (`asJobHandler`, очередь `session.cleanup`, cron `0 * * * *`):
раз в час удаляет сессии с `expiresAt <= now()`. Выполняется одним процессом кластера
(`APP_ROLE=worker|all`).

## События и сокеты (`SessionListener`)

| Событие                      | Источник | Действие                                                                                    |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `SessionTerminatedEvent`     | session  | `session:terminated { sessionId }` → `toUser`; `disconnectSession(userId, sessionId)`       |
| `PasswordChangedEvent`       | user     | с `currentSessionId` — `terminateAllOther`, без — `terminateAllByUser` (`password-changed`) |
| `UserPrivilegesChangedEvent` | user     | `TokenService.markPrivilegesChanged(userId)`: прежние access-токены — 401, сессии остаются  |
| `UserDeletedEvent`           | user     | `TokenService.revokeUser(userId)` + `disconnectUser(userId)` (сессии удаляются каскадом)    |

Ошибка обработчика логируется и не пробрасывается.

## Ошибки

`SESSION_NOT_FOUND` (404), `SESSION_FORBIDDEN` (403), `SESSION_INVALID`,
`SESSION_EXPIRED`, `SESSION_REFRESH_REUSED` (401).
