# Модуль ApiKey

API-ключи сервисов (интеграции) и схема аутентификации
`@Security("apiKey", scopes)`. Ключ `<prefix>.<secret>` показывается один раз
при создании; в БД — префикс для поиска и sha256 секрета.

## Структура файлов

```
src/modules/api-key/
├── api-key.module.ts      # @Module: провайдеры, asSecurityScheme, listener и политика комнаты
├── api-key.entity.ts      # ApiKey (таблица api_keys)
├── api-key.repository.ts  # Поиск по префиксу, страница, touch lastUsedAt
├── api-key.service.ts     # Создание, список, ключ по id, отзыв, проверка ключа
├── api-key.listener.ts    # ApiKeyListener: создание/отзыв → комната api-keys
├── api-key.socket-events.ts # apikey:updated в контракте сокета
├── api-key.scheme.ts      # Схема apiKey: X-Api-Key / Authorization: ApiKey
├── api-key.scopes.ts      # scopeSatisfied: сопоставление scope с wildcard
├── api-key.controller.ts  # REST /api/v1/api-keys (jwt + apikey:*)
├── api-key.errors.ts      # ApiKeyError (APIKEY_*)
├── api-key.permissions.ts # ApiKeyPermissions (definePermissions)
├── api-key.types.ts       # Константы формата ключа
├── dto/, validation/
├── events/               # ApiKeyCreatedEvent, ApiKeyRevokedEvent (пишет audit)
└── *.test.ts
```

## Entity: ApiKey (таблица `api_keys`)

| Поле         | Тип                     | Описание                                           |
| ------------ | ----------------------- | -------------------------------------------------- |
| `id`         | `uuid` (PK)             |                                                    |
| `name`       | `varchar(100)`          | Название                                           |
| `prefix`     | `varchar(8)`, unique    | Открытая часть ключа для поиска                    |
| `hash`       | `varchar(64)`           | sha256 секрета (hex)                               |
| `scopes`     | `varchar(100)[]`        | Разрешения: `<домен>:<действие>`, `<домен>:*`, `*` |
| `ownerId`    | `uuid` → users, CASCADE | Кто создал; от его имени действует сервис          |
| `lastUsedAt` | `timestamptz`, nullable | Обновляется не чаще раза в минуту                  |
| `expiresAt`  | `timestamptz`, nullable | Срок действия; `NULL` — бессрочный                 |
| `revokedAt`  | `timestamptz`, nullable | Отозван                                            |
| `createdAt`  | `timestamptz`           |                                                    |

Индексы: `IDX_API_KEYS_PREFIX` (unique), `IDX_API_KEYS_OWNER`.

## Ключ и проверка

- Формат: `<prefix>.<secret>`, prefix — 6 случайных байт (8 символов base64url),
  secret — 32 байта (43 символа base64url). Коллизия префикса — новая попытка.
- Схема `apiKey` берёт ключ из `X-Api-Key` или `Authorization: ApiKey <key>`,
  ищет по префиксу и сравнивает sha256 секрета через `timingSafeEqual`.
  Отозванный, просроченный, неверный — 401 `APIKEY_INVALID`; без ключа — 401
  `APIKEY_REQUIRED`.
- Scopes `@Security("apiKey", [...])` должны быть покрыты scope ключа: точное
  совпадение, wildcard (`integration:*`, `*`) или — для требования без действия
  (`integration`) — любой scope домена. Иначе 403 `APIKEY_SCOPE_DENIED`. Более
  точную проверку делает вызывающий модуль по `permissions` контекста.
- Контекст: `kind: "service"`, `userId` — владелец ключа, `sessionId:
"apikey:<id>"`, `roles: []`, `permissions` — scopes ключа.
- `lastUsedAt` — условный `UPDATE` (старше минуты), не задерживает запрос.

## REST (jwt)

| Метод | Путь                           | Право           | Описание                                                                   |
| ----- | ------------------------------ | --------------- | -------------------------------------------------------------------------- |
| POST  | `/api/v1/api-keys`             | `apikey:create` | `{ name, scopes[], expiresAt? }` → 201 `{ apiKey, key }` (ключ — один раз) |
| GET   | `/api/v1/api-keys`             | `apikey:view`   | `offset`/`limit` → `IPaginatedDto<ApiKeyDto>`                              |
| POST  | `/api/v1/api-keys/{id}/revoke` | `apikey:revoke` | Отзыв, 204 (повторный — тоже 204)                                          |

Права объявлены `definePermissions("apikey", …)` (группа «API-ключи»); по умолчанию
есть только у admin (через `*`).

## Использование другими модулями

`ApiKeyService` экспортируется из `index.ts` (создание, проверка, отзыв ключей).
Агенты нод ключами не пользуются: у них свой ключ из регистрации (модуль
agent). События `ApiKeyCreatedEvent` / `ApiKeyRevokedEvent` (после записи) пишет
в журнал модуль audit.

## Сокет

Комната списка ключей `api-keys` (`API_KEYS_ROOM`, `permissionRoomPolicy`, право
`apikey:view`). `ApiKeyListener`: `ApiKeyCreatedEvent`, `ApiKeyRevokedEvent` →
`apikey:updated` (`ApiKeyDto` из `ApiKeyService.get(id)`, без секрета).

## Конфиг

Нет.
