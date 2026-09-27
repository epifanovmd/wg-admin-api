# Модуль авторизации (Auth)

Регистрация, вход (пароль, 2FA; passkey — через `completeLogin`),
защита входа (блокировка аккаунта, политика пароля), сброс пароля, обновление
токенов, выход и refresh-cookie. Собственных сущностей нет: пользователи — через
`UserService`, сессии — через `SessionService`, токены сброса — через
`ResetPasswordTokensService`.

## Структура файлов

```
src/modules/auth/
├── auth.controller.ts          # REST (tsoa), 10 эндпоинтов; Retry-After и refresh-cookie
├── auth.service.ts             # Бизнес-логика
├── account-lockout.ts          # Блокировка входа по аккаунту (5 неудач / 15 мин → 15 мин)
├── auth-attempts.store.ts      # IAttemptsStore: счётчики, отметки, TTL (Redis | память)
├── token-subject.ts            # toTokenSubject(user) → TokenSubject ядра
├── refresh-cookie.ts           # httpOnly-cookie refresh_token
├── auth.errors.ts              # AuthError (AUTH_*)
├── auth.types.ts               # TLoginMethod, IAuthRequestMeta
├── auth.dto.ts                 # Интерфейсы запросов и ответов
├── auth.listener.ts            # EventBus → socket
├── auth.module.ts
├── events/                     # UserLoggedIn, LoginFailed, AccountLocked, UserSignedOut, TwoFactorEnabled/Disabled
├── validation/                 # Zod-схемы; account-password.ts — политика пароля
└── *.test.ts
```

## Эндпоинты (`/api/v1/auth`)

| Метод | Путь                      | Security | Guard (лимит, имя)                       | Ответ                                                                 |
| ----- | ------------------------- | -------- | ---------------------------------------- | --------------------------------------------------------------------- |
| POST  | `/sign-up`                | —        | 5 / 1 мин, `auth:sign-up`                | 201 `IUserWithTokensDto`; 409 `AUTH_USER_EXISTS`                      |
| POST  | `/sign-in`                | —        | 10 / 1 мин, `auth:sign-in`               | `IUserWithTokensDto` \| `I2FARequiredDto`; 401; 429 + `Retry-After`   |
| POST  | `/request-reset-password` | —        | 3 / 5 мин, `auth:request-reset-password` | всегда одинаковый `ApiResponseDto`                                    |
| POST  | `/reset-password`         | —        | 10 / 5 мин, `auth:reset-password`        | `ApiResponseDto`; 400 `AUTH_RESET_TOKEN_INVALID` / `VALIDATION_ERROR` |
| POST  | `/refresh`                | —        | 30 / 1 мин, `auth:refresh`               | `ITokensDto`; 401                                                     |
| POST  | `/sign-out`               | jwt      | —                                        | 204                                                                   |
| POST  | `/sign-out-all`           | jwt      | 5 / 1 мин, `auth:sign-out-all`           | 204                                                                   |
| POST  | `/enable-2fa`             | jwt      | 5 / 5 мин, `auth:2fa-settings`           | `ApiResponseDto`; 403 `AUTH_WRONG_PASSWORD`                           |
| POST  | `/disable-2fa`            | jwt      | 5 / 5 мин, `auth:2fa-settings`           | `ApiResponseDto`; 403                                                 |
| POST  | `/verify-2fa`             | —        | 5 / 1 мин, `auth:verify-2fa`             | `IUserWithTokensDto`; 401; 429 + `Retry-After`                        |

Тела запросов:

- `sign-up`: `{ email?, phone?, password, firstName?, lastName? }` — нужен email или телефон.
- `sign-in`: `{ login, password }` — `login` с `@` — email, иначе телефон.
- `reset-password`: `{ token, password }`.
- `refresh`: `{ refreshToken? }` — без токена в теле берётся cookie `refresh_token`.
- `enable-2fa`: `{ currentPassword, password, hint? }`; `disable-2fa`: `{ currentPassword, password }`.
- `verify-2fa`: `{ twoFactorToken, password }`.

## Правила

**Токены.** `TokenService` (ядро) выдаёт токены по нейтральному `TokenSubject
{ id, roles, permissions, emailVerified }`; собирает его из `User` только этот модуль —
`toTokenSubject` (права ролей ∪ прямые права). Каждый JWT несёт `scope`: `access`,
`refresh` или `2fa`; проверка требует точного совпадения. Токен сброса пароля — не JWT.

**Регистрация.** Email приводится к нижнему регистру, телефон — `normalizePhone`.
Email и телефон проверяются на уникальность оба; гонка регистраций (PG `23505`) → 409.

**Политика пароля** (`validatePasswordPolicy` из ядра, реэкспорт из модуля): минимум
8 символов, не совпадает с email (и его частью до `@`), не из встроенного списка частых
паролей. Применяется в Zod-схемах `sign-up` и `reset-password` и повторно в сервисе
(`ValidationException` → 400 `VALIDATION_ERROR`, поле `password`). При сбросе пароль
проверяется до погашения токена (`peek` → проверка → `check`). Смену пароля делает
модуль user — он должен вызывать ту же функцию.

**Вход.** Несуществующий логин и неверный пароль — одинаковый 401
`AUTH_INVALID_CREDENTIALS` (пароль проверяется и для несуществующего пользователя).
При включённой 2FA — `{ require2FA, twoFactorToken, twoFactorHint }` (токен `2fa`,
5 минут, уникальный `jti`).

**Блокировка аккаунта** (`AccountLockout`): `LOGIN_MAX_FAILURES = 5` неудач за
`LOGIN_FAILURE_WINDOW_MS = 15 мин` → вход закрыт на `LOGIN_LOCK_MS = 15 мин` с любого
IP: 429 `AUTH_ACCOUNT_LOCKED`, `details.retryAfter` (с) и заголовок `Retry-After`.
Ключ — id пользователя, для несуществующего логина — сам логин (поведение одинаково).
Успешный вход сбрасывает счётчик, сброс пароля снимает блокировку. Состояние —
`AuthAttemptsStore` (ключи `auth:login:*`, Redis или память процесса). IP-лимит
`ThrottleGuard` работает дополнительно.

**2FA.** Пароль 2FA — от 6 символов; включение/отключение требуют пароль аккаунта.
`verify-2fa`: неудачи на пользователя (`TWO_FACTOR_MAX_FAILURES = 5` за 15 мин) → 429
`AUTH_TOO_MANY_ATTEMPTS` + `Retry-After`; `jti` гасится при успехе (`SET NX`).

**Refresh.** `verifyRefresh` → `SessionService.validateRefresh` → новая пара →
`rotateRefreshToken` (атомарно). Повтор уже ротированного токена завершает сессию.

**Выход.** `sign-out` завершает текущую сессию (`reason = sign-out`) — её access-токен
сразу отзывается (повторный выход — не ошибка); `sign-out-all` — все сессии
пользователя, включая текущую. Оба чистят cookie и публикуют `UserSignedOutEvent`.

**Refresh-cookie** (`AUTH_REFRESH_COOKIE=true`): `sign-up`, `sign-in`, `verify-2fa`,
`refresh`, вход по passkey ставят `refresh_token` — `HttpOnly`,
`Secure` в production, `SameSite=Strict`, `Path=/api/v1/auth`, срок —
`JWT_REFRESH_TTL_DAYS`. Токен остаётся и в теле ответа. В production за прокси нужен
`TRUST_PROXY`, иначе Koa не отправит Secure-cookie.

**Сброс пароля.** `request-reset-password` отвечает одинаково для любого логина; письмо
в фоне, ошибка — в лог. `reset-password` проверяет пароль, гасит токен, сбрасывает 2FA,
меняет пароль, снимает блокировку и публикует `PasswordChangedEvent(userId, "reset")` —
сессии завершает модуль session.

## События

| Событие                  | Когда                                                                                        | Слушатели                                    |
| ------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `UserLoggedInEvent`      | вход любым способом (`method`: password, 2fa, passkey, sign-up), `request` { ip, userAgent } | `session:new` (socket), аудит                |
| `LoginFailedEvent`       | неверный пароль / 2FA, попытка при блокировке                                                | аудит                                        |
| `AccountLockedEvent`     | аккаунт заблокирован                                                                         | аудит                                        |
| `UserSignedOutEvent`     | `sign-out` (`scope: current`) / `sign-out-all` (`all`)                                       | аудит                                        |
| `TwoFactorEnabledEvent`  | включение 2FA                                                                                | `auth:2fa-changed { enabled: true }`, аудит  |
| `TwoFactorDisabledEvent` | отключение 2FA                                                                               | `auth:2fa-changed { enabled: false }`, аудит |
| `PasswordChangedEvent`   | сброс пароля (класс модуля user)                                                             | session, user, аудит                         |

## Ошибки (`AUTH_*`)

`INVALID_CREDENTIALS` (401), `USER_EXISTS` (409), `LOGIN_REQUIRED` (400),
`ACCOUNT_LOCKED` (429), `TOO_MANY_ATTEMPTS` (429), `WRONG_PASSWORD` (403),
`TWO_FACTOR_ALREADY_ENABLED` / `TWO_FACTOR_NOT_ENABLED` (400),
`TWO_FACTOR_WRONG_PASSWORD` (403), `TWO_FACTOR_INVALID` / `TWO_FACTOR_TOKEN_USED` (401),
`REFRESH_TOKEN_MISSING` (401). Ошибки проверки токенов (`AUTH_TOKEN_*`,
`AUTH_SESSION_REVOKED`, `AUTH_INSUFFICIENT_*`) определены в ядре.

## Публичный API для других модулей

`AuthService.completeLogin(user, deviceInfo, method)` — открыть сессию после
альтернативной аутентификации; `toTokenSubject`; `setRefreshCookie` /
`clearRefreshCookie`; `validatePasswordPolicy`.

## Конфиг

`JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `AUTH_REFRESH_COOKIE`, `REDIS_URL`
(общие счётчики блокировки и отзыв токенов между репликами).

## Зависимости

`UserService`, `MailerService`, `ResetPasswordTokensService`, `SessionService`,
`TokenService`, `EventBus`, `AuthAttemptsStore` (свой провайдер).
