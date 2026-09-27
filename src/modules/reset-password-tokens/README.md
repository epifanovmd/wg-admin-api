# Модуль ResetPasswordTokens

Сервисный модуль одноразовых токенов сброса пароля. Контроллера нет — используется
модулем auth.

## Структура файлов

```
src/modules/reset-password-tokens/
├── reset-password-tokens.module.ts
├── reset-password-tokens.entity.ts
├── reset-password-tokens.repository.ts
├── reset-password-tokens.service.ts
├── reset-password-tokens.errors.ts   # ResetPasswordError (AUTH_RESET_*)
├── reset-password-tokens.service.test.ts
└── index.ts
```

## Сущность `ResetPasswordTokens` (таблица `reset_password_tokens`)

| Поле                      | Тип           | Описание                                         |
| ------------------------- | ------------- | ------------------------------------------------ |
| `userId`                  | `uuid` (PK)   | Один токен на пользователя                       |
| `tokenHash`               | `varchar(64)` | sha256 токена (сам токен в БД не хранится)       |
| `expiresAt`               | `timestamptz` | Срок (`config.auth.resetPassword.expireMinutes`) |
| `issuedAt`                | `timestamptz` | Время выпуска — для cooldown                     |
| `createdAt` / `updatedAt` | `timestamptz` |                                                  |

Индекс `IDX_RESET_TOKENS_TOKEN_HASH` (unique). `OneToOne → User` (`CASCADE`).

## `ResetPasswordTokensService`

| Метод            | Описание                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `create(userId)` | Выпускает opaque-токен (32 случайных байта, base64url), upsert хеша. `null`, если прошлый выпущен < 60 с назад.                            |
| `peek(token)`    | Проверяет токен без погашения → `{ userId }`: auth проверяет новый пароль до того, как токен израсходован.                                 |
| `check(token)`   | Ищет по хешу, удаляет по условию `{ userId, tokenHash }`; `affected !== 1`, неизвестный или истёкший токен → 400. Возвращает `{ userId }`. |

## Правила

- Токен не JWT и не может быть предъявлен как Bearer.
- Одноразовость при гонке: из двух одновременных `check` одного токена проходит один.
- Истечение — 400, не 500. Код ошибки — `AUTH_RESET_TOKEN_INVALID` (часть сценария
  входа, клиент обрабатывает вместе с кодами `AUTH_*`).
