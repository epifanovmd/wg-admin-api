# Модуль Biometric

Вход по биометрии устройства: устройство регистрирует публичный ключ (RSA, SPKI DER
в base64), затем подписывает одноразовый nonce. Верная подпись открывает новую сессию.

## Структура файлов

```
src/modules/biometric/
├── biometric.module.ts
├── biometric.entity.ts
├── biometric.repository.ts
├── biometric.service.ts
├── biometric.controller.ts
├── biometric.dto.ts
├── biometric.errors.ts               # BiometricError (BIOMETRIC_*)
├── events/biometric.events.ts        # BiometricAddedEvent, BiometricRemovedEvent
├── validation/biometric.validate.ts   # RegisterBiometric, GenerateNonce, VerifyBiometricSignature
├── validation/biometric.validation.test.ts
└── biometric.service.test.ts
```

## Сущность `Biometric` (таблица `biometrics`)

| Поле                      | Тип            | Описание                     |
| ------------------------- | -------------- | ---------------------------- |
| `id`                      | `uuid` (PK)    |                              |
| `userId`                  | `uuid`         | FK → users (`CASCADE`)       |
| `deviceId`                | `varchar(100)` | Уникален в паре с `userId`   |
| `publicKey`               | `text`         | SPKI DER в base64            |
| `deviceName`              | `varchar(100)` | nullable                     |
| `challenge`               | `varchar(64)`  | Текущий nonce, nullable      |
| `challengeExpiresAt`      | `timestamptz`  | Срок nonce (5 мин), nullable |
| `lastUsedAt`              | `timestamptz`  | nullable                     |
| `createdAt` / `updatedAt` | `timestamptz`  |                              |

## Эндпоинты (`/api/v1/biometric`)

| Метод  | Путь                | Security | Guard                                    | Тело / ответ                                                                                     |
| ------ | ------------------- | -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/register`         | jwt      | —                                        | `{ deviceId, deviceName, publicKey }` → `{ registered }`; 409 `BIOMETRIC_DEVICE_LIMIT` (5)       |
| POST   | `/generate-nonce`   | —        | 10 / 1 мин, `biometric:generate-nonce`   | `{ userId, deviceId }` → `{ nonce }`                                                             |
| POST   | `/verify-signature` | —        | 10 / 1 мин, `biometric:verify-signature` | `{ userId, deviceId, nonce, signature }` → `{ verified, tokens }`; 401 `BIOMETRIC_VERIFY_FAILED` |
| GET    | `/devices`          | jwt      | —                                        | `{ devices }`                                                                                    |
| DELETE | `/{deviceId}`       | jwt      | —                                        | 204; 404 `BIOMETRIC_DEVICE_NOT_FOUND`                                                            |

## Правила

- Валидация: `deviceId` 1–100, `deviceName` 1–100, `publicKey` 1–4096, `nonce` ≤ 64,
  `signature` ≤ 2048, `userId` — uuid.
- `generate-nonce` отвечает одинаково для незарегистрированного устройства (nonce
  не сохраняется) — наличие устройства не раскрывается.
- `verify-signature`: nonce должен совпасть с выданным и не истечь; гасится атомарно
  (`UPDATE … WHERE challenge = :nonce AND challenge_expires_at > now()`) ещё до
  проверки подписи — одна попытка на nonce. Любой провал — 401 с одним сообщением.
- Успех — новая сессия через `AuthService.completeLogin(user, deviceInfo, "biometric")`
  (данные устройства запроса, имя по умолчанию — `deviceName` устройства): тот же путь,
  что у пароля — `UserLoggedInEvent`, аудит. При `AUTH_REFRESH_COOKIE` контроллер
  ставит cookie `refresh_token`.
- Перерегистрация ключа устройства сбрасывает выданный nonce.

## События

| Событие                 | Когда                                            |
| ----------------------- | ------------------------------------------------ |
| `BiometricAddedEvent`   | регистрация или перерегистрация ключа устройства |
| `BiometricRemovedEvent` | удаление устройства                              |

## Ошибки

`BIOMETRIC_DEVICE_LIMIT` (409), `BIOMETRIC_DEVICE_NOT_FOUND` (404),
`BIOMETRIC_VERIFY_FAILED` (401).

## Зависимости

`UserService`, `AuthService` (модуль auth), `EventBus`.
