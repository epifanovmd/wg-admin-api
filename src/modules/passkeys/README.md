# Модуль Passkeys (WebAuthn)

Регистрация и вход по WebAuthn/FIDO2 passkeys (`@simplewebauthn/server`).

## Структура файлов

```
src/modules/passkeys/
├── passkeys.module.ts                 # @Module: entities, провайдеры, cron-задача
├── passkey.entity.ts                  # Passkey
├── passkey-challenge.entity.ts        # PasskeyChallenge
├── passkeys.repository.ts
├── passkey-challenge.repository.ts
├── passkeys.service.ts
├── passkeys.controller.ts
├── passkey-challenge-cleanup.job.ts   # PasskeyChallengeCleanupJob (cron)
├── passkeys.errors.ts                 # PasskeyError (PASSKEY_*)
├── events/passkey.events.ts           # PasskeyAddedEvent, PasskeyRemovedEvent
├── passkeys.dto.ts                    # PasskeyDto, тела запросов/ответов
├── webauthn.dto.ts                    # WebAuthn JSON-структуры для OpenAPI
└── *.test.ts
```

## Сущности

**`Passkey`** (`passkeys`): `id` (credential ID, PK), `publicKey` (bytea, COSE),
`userId` (FK → users, `CASCADE`), `counter`, `deviceType`, `transports` (jsonb),
`lastUsed`, `createdAt`, `updatedAt`.

**`PasskeyChallenge`** (`passkey_challenges`): `id`, `userId`, `challenge`,
`expiresAt` (TTL 5 мин), `createdAt`.

## Эндпоинты (`/api/v1/passkeys`)

| Метод  | Путь                               | Security | Guard                                         | Ответ                                                   |
| ------ | ---------------------------------- | -------- | --------------------------------------------- | ------------------------------------------------------- |
| GET    | `/?offset&limit`                   | jwt      | —                                             | `IPaginatedDto<PasskeyDto>` — свои, новые первыми       |
| DELETE | `/{id}`                            | jwt      | —                                             | 204; `PASSKEY_NOT_FOUND` — нет или чужой                |
| POST   | `/generate-registration-options`   | jwt      | —                                             | Options для `credentials.create()`                      |
| POST   | `/verify-registration`             | jwt      | —                                             | `{ verified }`; 400; `PASSKEY_ALREADY_REGISTERED` (409) |
| POST   | `/generate-authentication-options` | —        | 10 / 1 мин, `passkeys:authentication-options` | Options для `credentials.get()`                         |
| POST   | `/verify-authentication`           | —        | 10 / 1 мин, `passkeys:verify-authentication`  | `{ verified, tokens }`; `PASSKEY_AUTH_FAILED` (401)     |

## Правила

- `PasskeyDto` не содержит публичного ключа и счётчика.
- Ошибки проверки регистрации — 400 (`PASSKEY_CHALLENGE_MISSING`,
  `PASSKEY_REGISTRATION_FAILED`, `PASSKEY_LOGIN_REQUIRED`), входа — 401
  `PASSKEY_AUTH_FAILED` без credential id; детали библиотеки — только в debug-лог.
- Логин для authentication-options: email (нижний регистр) или телефон через
  `normalizePhone`; ответ для несуществующего логина неотличим (фиктивный ключ).
- Challenge одноразовый: проверяется тот, что подписал клиент (из
  `clientDataJSON`), и гасится атомарно (`consumeChallenge` — `DELETE` с проверкой
  `affected`) до проверки подписи. Повтор ответа, в том числе параллельный, —
  400/401; неудачная попытка тоже гасит challenge. Другие challenge
  пользователя не трогаются: чужой запрос authentication-options по логину не
  срывает начатый вход, регистрация ключа — вход на другом устройстве.
  Счётчик подписей от повтора не защищает: у passkey платформ он всегда 0.
- Повторная регистрация того же credential — 409 (уникальный id ключа).
- Успешный вход обновляет `counter`/`lastUsed` и открывает сессию
  через `AuthService.completeLogin(user, deviceInfo, "passkey")` — тот же путь, что у
  пароля: `UserLoggedInEvent`, аудит. При `AUTH_REFRESH_COOKIE` контроллер ставит
  cookie `refresh_token`.

## События

| Событие               | Когда                       |
| --------------------- | --------------------------- |
| `PasskeyAddedEvent`   | успешная регистрация        |
| `PasskeyRemovedEvent` | пользователь удалил passkey |

## Задачи

`PasskeyChallengeCleanupJob` — очередь `passkeys.challenge-cleanup`, cron
`*/15 * * * *`: удаляет просроченные challenge.

## Зависимости

`UserService`, `AuthService` (модуль auth), `DataSource`, `EventBus`.
