# Модуль User

Управление пользователями: аккаунт (email, телефон, username), привилегии (роли и
прямые права), подтверждение email кодом, смена email с подтверждением, смена пароля,
удаление. При старте засевает роли/права и создаёт администратора, в
development — демо-пользователей. Роли и права (`src/modules/role`,
`src/modules/permission`) регистрируются в этом же модуле.

---

## Структура файлов

```
src/modules/user/
├── admin.bootstrap.ts                  # Засев ролей/прав + администратор из конфига (идемпотентно)
├── seed.bootstrap.ts                   # Демо-пользователи alice/bob/charlie (только development)
├── user.entity.ts                      # User
├── email-change-request.entity.ts      # EmailChangeRequest — запрос смены email
├── user.repository.ts                  # Запросы; escapeLike — экранирование ILIKE
├── email-change-request.repository.ts  # findByUserId, атомарный incrementAttempts
├── user.service.ts                     # Бизнес-логика пользователя
├── email-change.service.ts             # Смена email: запрос → код → подтверждение
├── password-policy.ts                  # Контракт политики пароля (PASSWORD_POLICY)
├── user.errors.ts                      # UserError — коды USER_*
├── user.permissions.ts                 # UserPermissions (definePermissions("user"))
├── user.controller.ts                  # REST, /api/v1/user
├── user.listener.ts                    # EventBus → socket (адресно и комната users); права роли → события пользователей
├── user.socket-events.ts               # user:* в контракте сокета
├── user-grant.resolver.ts              # grantOfUser, UserGrantResolver (IGrantResolver ядра)
├── user.module.ts
├── dto/                                # UserDto, списки/опции, тела запросов
├── events/                             # Доменные события
└── validation/                         # Zod-схемы тел и query
```

---

## Сущности

### User (`users`)

| Поле                      | Тип            | Ограничения                             |
| ------------------------- | -------------- | --------------------------------------- |
| `id`                      | `uuid`         | PK                                      |
| `email`                   | `varchar(50)`  | nullable, уникален среди не-NULL        |
| `emailVerified`           | `boolean`      | default `false`                         |
| `phone`                   | `varchar(14)`  | nullable, уникален среди не-NULL, `+7…` |
| `username`                | `varchar(32)`  | nullable, уникален среди не-NULL        |
| `passwordHash`            | `text`         | хеш `core/auth/password` (scrypt)       |
| `twoFactorHash`           | `text`         | nullable                                |
| `twoFactorHint`           | `varchar(100)` | nullable                                |
| `createdAt` / `updatedAt` | `timestamptz`  |                                         |

Индексы (частичные, `WHERE <col> IS NOT NULL`): `IDX_USERS_EMAIL`, `IDX_USERS_PHONE`,
`IDX_USERS_USERNAME`. Связи: `roles` (M:N `user_roles`), `directPermissions`
(M:N `user_permissions`), `profile` (1:1, создаётся вместе с пользователем).

### EmailChangeRequest (`email_change_requests`)

| Поле        | Тип           | Описание                                       |
| ----------- | ------------- | ---------------------------------------------- |
| `id`        | `uuid`        | PK                                             |
| `userId`    | `uuid`        | FK → `users` (CASCADE), уникален — один запрос |
| `newEmail`  | `varchar(50)` | новый адрес (trim + lower case)                |
| `codeHash`  | `varchar(64)` | SHA-256 от `userId:code`; сам код не хранится  |
| `attempts`  | `int`         | неверных вводов, default 0                     |
| `expiresAt` | `timestamptz` | создание + 15 мин                              |
| `createdAt` | `timestamptz` | для cooldown повторного запроса                |

Индекс `IDX_EMAIL_CHANGE_REQUESTS_USER` (unique).

---

## Endpoints (`/api/v1/user`)

### Текущий пользователь

| Метод   | Путь                   | Тело                               | Ответ     | Описание                                                                                                |
| ------- | ---------------------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `GET`   | `my`                   | —                                  | `UserDto` | Свои данные                                                                                             |
| `PATCH` | `my/update`            | `{ email?, phone? }`               | `UserDto` | Телефон — сразу. Email — **не сразу**: запрос смены (см. «Смена email»). Занятые → 409                  |
| `POST`  | `my/email/confirm`     | `{ code }` (6 цифр)                | `UserDto` | Подтверждение смены email; `ThrottleGuard(10, 15 мин, "user:email-change-confirm")`                     |
| `POST`  | `my/delete`            | `{ password }`                     | 204       | Удаление аккаунта с подтверждением паролем                                                              |
| `PATCH` | `my/username`          | `{ username }`                     | `UserDto` | Username, занят → 409                                                                                   |
| `POST`  | `verify-email/request` | —                                  | 204       | Код на email. Повтор не чаще раза в 60 с (429); `ThrottleGuard(5, 15 мин, "user:verify-email-request")` |
| `POST`  | `verify-email`         | `{ code }` (6 цифр)                | 204       | Подтверждение кода; `ThrottleGuard(10, 15 мин, "user:verify-email")`                                    |
| `POST`  | `changePassword`       | `{ currentPassword, newPassword }` | 204       | `newPassword` 8–100 символов + политика пароля; остальные сессии завершаются                            |

`UserDto` — `{ id, email, emailVerified, phone, username, profile?, roles,
directPermissions, createdAt, updatedAt }` (`profile` — `ProfileDto`, если загружен).
Публичного представления пользователя (поиск, профиль по username) нет — чужие данные
видит только администратор (`user:view`).

### Администрирование

| Метод    | Путь                 | Право             | Ответ                                          | Описание                                                                                                                                        |
| -------- | -------------------- | ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `all`                | `user:view`       | `IUserAdminListDto` = `IPaginatedDto<UserDto>` | Query: `query` (≥ 2, по email), `limit` ≤ 100, `offset`                                                                                         |
| `GET`    | `options`            | `user:view`       | `IUserOptionsDto`                              | Query: `query` (≥ 2)                                                                                                                            |
| `GET`    | `{id}`               | `user:view`       | `UserDto`                                      |                                                                                                                                                 |
| `PATCH`  | `setPrivileges/{id}` | `user:privileges` | `UserDto`                                      | См. «Привилегии»                                                                                                                                |
| `PATCH`  | `update/{id}`        | `user:update`     | `UserDto`                                      | Email/телефон **сразу**; новый email → `emailVerified = false` + код; суперпользователя — только суперпользователь (`USER_SUPERUSER_EDIT`, 403) |
| `DELETE` | `delete/{id}`        | `user:delete`     | 204                                            | Нельзя удалить себя и суперпользователя (403)                                                                                                   |

Списки — единый контракт `IPaginatedDto { items, total, offset, limit }`: `limit` по
умолчанию 20, максимум 100; без параметров — первая страница, не вся таблица.
`{id}` — `UUID` (неверный формат → 400 `VALIDATION_ERROR`). `options` ищет по email, имени и
фамилии профиля (`ILIKE`, `%`/`_` экранируются `escapeLike`).

---

## Правила

### Смена email (`EmailChangeService`)

1. `PATCH my/update { email }` — адрес не меняется. Проверки: адрес свободен
   (`USER_EMAIL_TAKEN`), прошлый запрос старше минуты (`USER_EMAIL_CHANGE_TOO_FREQUENT`).
   В одной транзакции: прежний запрос удаляется, новый сохраняется, в очередь ставятся
   письмо `email-change-code` на **новый** адрес и `email-change-notice` на **старый**
   (`manager` передаётся в `MailerService.send` — outbox). Совпадает с текущим — ничего.
   Если в запросе есть и телефон, занятость телефона проверяется до запроса смены email,
   а сохраняется телефон после.
2. `POST my/email/confirm { code }`:
   - нет запроса → `USER_EMAIL_CHANGE_NOT_FOUND` (404);
   - истёк (15 мин) → запрос удаляется, `USER_EMAIL_CHANGE_EXPIRED` (410);
   - неверный код → атомарный `attempts + 1`, `USER_EMAIL_CHANGE_INVALID_CODE` (400,
     `details.attemptsLeft`); 5-я неверная попытка удаляет запрос →
     `USER_EMAIL_CHANGE_ATTEMPTS_EXCEEDED` (429);
   - адрес успели занять → запрос удаляется, `USER_EMAIL_TAKEN` (409; и при гонке за
     уникальный индекс);
   - успех → в транзакции запрос гасится (`DELETE … WHERE id`: из двух параллельных
     подтверждений проходит одно), `email = newEmail`, `emailVerified = true`; события
     `EmailChangedEvent`, `EmailVerifiedEvent`.

Язык писем — `profile.locale` (см. модуль mailer). Смена администратором
(`update/{id}`) — прямая, без запроса.

### Привилегии (`setPrivileges`)

- Роли и права должны существовать — неизвестные → 400 (`USER_ROLES_NOT_FOUND`,
  `USER_PERMISSIONS_NOT_FOUND`, список в `details`).
- Менять собственные привилегии нельзя (`USER_OWN_PRIVILEGES`, 403).
- Роль `admin`, право `*` выдаёт и привилегии суперпользователя меняет только
  суперпользователь (`USER_SUPERUSER_ONLY`, 403).
- Роль `user` по умолчанию **без** прав модуля `user:*`.
- Сессии не завершаются: access-токены, выданные до смены, отклоняются
  (`AUTH_PRIVILEGES_CHANGED`, 401), клиент обновляет токен (модуль session).

### Создание

`createUser(body, roles = ["user"])` — пользователь, профиль и роли в одной
транзакции; занятый email/телефон (PG 23505) → `USER_ALREADY_EXISTS` (409). Нет роли
по умолчанию → `USER_DEFAULT_ROLE_MISSING` (500). `createAdmin` — то же с ролью `admin`.

### Пароль

- Zod: `newPassword` 8–100 символов, отличается от текущего.
- Политика пароля — контракт `IPasswordPolicy` (`password-policy.ts`): реализации
  собираются multi-inject по `PASSWORD_POLICY` (опционально) и вызываются в
  `changeOwnPassword` до записи хеша с контекстом `{ userId, email, username }`.
  Модуль auth регистрирует свою: `asPasswordPolicy(Cls)` в `providers`, внутри —
  `validatePasswordPolicy`. Без регистрации действует только Zod.
- `changeOwnPassword` — проверка текущего пароля (`USER_WRONG_CURRENT_PASSWORD`),
  одно событие `PasswordChangedEvent(userId, "change", currentSessionId)`.
- `changePassword(userId, password)` — запись хеша без проверок и событий для
  сценария сброса (политику и событие `"reset"` обеспечивает вызывающий).

### Удаление

`UserDeletedEvent` — только после фактического удаления (`affected > 0`).

### Подтверждённый email (`RequireVerifiedEmailGuard`)

Guard читает claim `emailVerified` из access-токена; claim обновляется при выдаче
нового токена — после подтверждения клиент обновляет токены.

---

## Ошибки (`UserError`, коды `USER_*`)

| Код                                                              | Статус |
| ---------------------------------------------------------------- | ------ |
| `NOT_FOUND`, `EMAIL_CHANGE_NOT_FOUND`                            | 404    |
| `ALREADY_EXISTS`, `EMAIL_TAKEN`, `PHONE_TAKEN`, `USERNAME_TAKEN` | 409    |
| `EMAIL_ALREADY_VERIFIED`                                         | 409    |
| `USERNAME_INVALID`, `ROLES_NOT_FOUND`, `PERMISSIONS_NOT_FOUND`   | 400    |
| `EMAIL_MISSING`, `EMAIL_CHANGE_INVALID_CODE`                     | 400    |
| `OWN_PRIVILEGES`, `SUPERUSER_ONLY`, `SELF_DELETE_VIA_ADMIN`      | 403    |
| `SUPERUSER_EDIT`                                                 | 403    |
| `SUPERUSER_DELETE`, `WRONG_PASSWORD`, `WRONG_CURRENT_PASSWORD`   | 403    |
| `EMAIL_CHANGE_EXPIRED`                                           | 410    |
| `VERIFY_EMAIL_TOO_FREQUENT`, `EMAIL_CHANGE_TOO_FREQUENT`         | 429    |
| `EMAIL_CHANGE_ATTEMPTS_EXCEEDED`                                 | 429    |
| `DEFAULT_ROLE_MISSING`                                           | 500    |

## Права

`UserPermissions` (группа «Пользователи»): `user:view` — просмотр, `user:update` —
изменение контактов, `user:delete` — удаление, `user:privileges` — назначение ролей и
прав.

## Актуальные права (`UserGrantResolver`)

`grantOfUser(user)` — роли и эффективные права (права ролей ∪ прямые); из него же
строится субъект токена. `UserGrantResolver` (`asGrantResolver`) читает пользователя из
БД и отдаёт `IUserGrant` для `AccessService` ядра — проверки прав по userId без
HTTP-контекста (политики сокет-комнат, слушатели).

---

## События

| Событие                      | Когда                                                                     | Поля                                    |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `EmailChangeRequestedEvent`  | запрос смены email создан, письма в очереди                               | `userId`, `newEmail`                    |
| `EmailChangedEvent`          | email сменён после подтверждения                                          | `userId`, `oldEmail`, `newEmail`        |
| `EmailVerifiedEvent`         | email подтверждён (в т. ч. сменой email)                                  | `userId`                                |
| `PasswordChangedEvent`       | смена (`"change"`, с `currentSessionId`) / сброс (`"reset"`, модуль auth) | `userId`, `method`, `currentSessionId?` |
| `UserChangedEvent`           | `createUser`, изменение контактов (email/телефон)                         | `userId`                                |
| `UserDeletedEvent`           | пользователь удалён                                                       | `userId`                                |
| `UserPrivilegesChangedEvent` | `setPrivileges`; изменение прав роли — для каждого её пользователя        | `userId`, `roles`, `permissions`        |
| `UsernameChangedEvent`       | username изменён                                                          | `userId`, `username`                    |

## UserListener

Комната списка пользователей `users` (`USERS_ROOM`, `permissionRoomPolicy`, право
`user:view`): `user:updated` — актуальный `UserDto` на `UserChangedEvent`,
`UserPrivilegesChangedEvent`, `EmailChangedEvent`, `EmailVerifiedEvent`,
`UsernameChangedEvent`, `ProfileUpdatedEvent` (profile); `user:deleted { id }` — на
`UserDeletedEvent`. Адресные реакции (`toUser`):

| Событие                       | Реакция                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `EmailChangedEvent`           | socket `user:email-changed { email }`                                                                            |
| `EmailVerifiedEvent`          | socket `user:email-verified`                                                                                     |
| `UserDeletedEvent`            | socket `session:terminated { sessionId: "all" }` + `disconnectUser`                                              |
| `PasswordChangedEvent`        | socket `user:password-changed` (завершение сессий — модуль session)                                              |
| `UserPrivilegesChangedEvent`  | socket `user:privileges-changed { roles, permissions }` (эффективные права) + `SocketRoomService.revalidateUser` |
| `UsernameChangedEvent`        | socket `user:username-changed`                                                                                   |
| `RolePermissionsChangedEvent` | `UserService.notifyRoleMembersPrivilegesChanged` → `UserPrivilegesChangedEvent` каждому пользователю роли        |
| `RoleDeletedEvent`            | `UserService.notifyUsersPrivilegesChanged(memberIds)` → `UserPrivilegesChangedEvent` бывшим пользователям роли   |

---

## Bootstrappers

- **AdminBootstrap** (`critical = false`): `RoleService.seedDefaultPermissions()`
  (все права реестра `definePermissions`), затем администратор из `config.auth.admin`
  (`emailVerified = true`), если его ещё нет. Созданный параллельной репликой
  (`USER_ALREADY_EXISTS` / 409) — не ошибка; остальные ошибки пробрасываются.
- **SeedBootstrap** (`critical = false`, только development): демо-пользователи
  `SEED_USERS` (alice, bob, charlie; пароль `SEED_USER_PASSWORD`, email подтверждён,
  имя и фамилия в профиле).

## Задачи и конфиг

Собственных очередей и переменных окружения нет; письма — через `mail.send`
(модуль mailer).

---

## Зависимости

`UserService`: `MailerService`, `OtpService`, `OtpRepository`, `UserRepository`,
`RoleRepository`, `PermissionRepository`, `DataSource`,
`EventBus`, `EmailChangeService`, политики `PASSWORD_POLICY` (опционально).
`EmailChangeService`: `UserRepository`, `EmailChangeRequestRepository`,
`MailerService`, `DataSource`, `EventBus`.

## Тесты

- `user.service.test.ts` — привилегии, создание, email/телефон (админ и свой), 409 с
  точными кодами, подтверждение email и cooldown, пароль и политика, удаление,
  пагинация списков, username.
- `email-change.service.test.ts` — запрос (хеш кода, письма в транзакции, cooldown,
  занятость, гонки) и подтверждение (истечение, попытки, занятость, гонки).
- `user.listener.test.ts`, `admin.bootstrap.test.ts`, `dto/user.dto.test.ts`,
  `validation/user.validation.test.ts`.
