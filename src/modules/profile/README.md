# Модуль Profile

Профили пользователей: личные данные (имя, фамилия, дата рождения, пол, язык
писем). Профиль создаётся вместе с пользователем (1:1) и не удаляется отдельно —
«удаление» очищает личные поля.

## Структура файлов

```
src/modules/profile/
├── profile.module.ts                 # Объявление модуля (@Module)
├── profile.entity.ts                 # Entity профиля (таблица profiles)
├── profile.repository.ts             # Репозиторий профилей
├── profile.service.ts                # Сервис управления профилями
├── profile.controller.ts             # REST-контроллер (tsoa)
├── profile.errors.ts                 # ProfileError — коды PROFILE_*
├── profile.permissions.ts            # ProfilePermissions (definePermissions("profile"))
├── profile.listener.ts               # EventBus → сокет (profile:updated владельцу)
├── profile.socket-events.ts          # profile:updated в контракте сокета
├── dto/
│   ├── profile.dto.ts                # ProfileDto, PublicProfileDto, IProfileListDto
│   ├── profile-update-request.dto.ts # IProfileUpdateRequestDto
│   └── index.ts
├── events/
│   ├── profile-updated.event.ts      # ProfileUpdatedEvent
│   ├── user-online.event.ts          # UserOnlineEvent (публикует socket)
│   ├── user-offline.event.ts         # UserOfflineEvent (публикует socket)
│   └── index.ts
├── validation/
│   ├── update-profile.validate.ts    # UpdateProfileSchema
│   ├── profile-list-query.validate.ts # ProfileListQuerySchema (limit/offset)
│   └── index.ts
├── profile.service.test.ts
└── index.ts                          # Публичный API модуля
```

## Entity: Profile (таблица `profiles`)

| Поле        | Тип                                     | Описание                                       |
| ----------- | --------------------------------------- | ---------------------------------------------- |
| `id`        | `uuid` (PK)                             |                                                |
| `userId`    | `uuid` (unique)                         | ID пользователя                                |
| `firstName` | `varchar(40)`, nullable                 | Имя                                            |
| `lastName`  | `varchar(40)`, nullable                 | Фамилия                                        |
| `birthDate` | `date`, nullable                        | Дата рождения                                  |
| `gender`    | `varchar(20)`, nullable                 | Пол (свободная форма)                          |
| `locale`    | `varchar(10)`, nullable, default `NULL` | Язык пользователя (`ru`, `en-US`) — язык писем |
| `createdAt` | `timestamptz`                           |                                                |
| `updatedAt` | `timestamptz`                           |                                                |

Индекс `IDX_PROFILES_USER_ID` (unique). Связь `OneToOne` → `User` (`user_id`,
`onDelete: CASCADE`).

## Endpoints (`/api/v1/profile`)

| Метод    | Путь               | Security                                                                  | Описание                                                                                            |
| -------- | ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/my`              | jwt                                                                       | Свой профиль → `ProfileDto`                                                                         |
| `PATCH`  | `/my/update`       | jwt + `@ValidateBody(UpdateProfileSchema)`                                | Обновить свой профиль (`IProfileUpdateRequestDto`) → `ProfileDto`                                   |
| `DELETE` | `/my/delete`       | jwt                                                                       | Очистить свой профиль: имя, фамилия, дата рождения, пол → `null`; запись остаётся. 204              |
| `GET`    | `/all`             | jwt, `permission:profile:view` + `@ValidateQuery(ProfileListQuerySchema)` | `IProfileListDto` = `IPaginatedDto<PublicProfileDto>`; `limit` по умолчанию 20, ≤ 100; `offset` ≥ 0 |
| `GET`    | `/{userId}`        | jwt                                                                       | Профиль пользователя по `userId` → `PublicProfileDto`                                               |
| `PATCH`  | `/update/{userId}` | jwt, `permission:profile:update` + `@ValidateBody(UpdateProfileSchema)`   | Обновить профиль другого пользователя → `ProfileDto`                                                |
| `DELETE` | `/delete/{userId}` | jwt, `permission:profile:delete`                                          | Очистить профиль другого пользователя (запись остаётся). 204                                        |

`{userId}` — `UUID` (неверный формат → 400 `VALIDATION_ERROR`). Профиль
суперпользователя через `update/{userId}` и `delete/{userId}` меняет только
суперпользователь (`PROFILE_SUPERUSER_EDIT`, 403).

### Валидация обновления (`UpdateProfileSchema`)

- `firstName`, `lastName` — строка ≤ 40 символов (trim) или `null`;
- `gender` — строка ≤ 20 символов или `null`;
- `locale` — код языка (`ru`, `en`, `en-US`, `pt_BR`), ≤ 10 символов, или `null`.
  Письма отправляются на `ru`/`en` (прочие языки — `ru`), см. модуль mailer;
- `birthDate` — ISO-дата (`YYYY-MM-DD` или date-time), не раньше 1900-01-01 и не в
  будущем, или `null`.

## Сервис `ProfileService`

| Метод                                       | Описание                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getProfiles(offset?, limit?)`              | `IPaginatedDto<PublicProfileDto>` через `normalizePagination`/`toPage`; `createdAt DESC`.       |
| `getProfileByAttr(where)`                   | Поиск по произвольным условиям (с `user`). Нет — `PROFILE_NOT_FOUND` (404).                     |
| `getProfileByUserId(userId)`                | Профиль по `userId`. Нет — `PROFILE_NOT_FOUND` (404).                                           |
| `updateProfile(userId, body)`               | Обновление. Публикует `ProfileUpdatedEvent`.                                                    |
| `deleteProfile(userId)`                     | Очистка личных полей (запись остаётся). Публикует `ProfileUpdatedEvent`. Нет — 404.             |
| `updateProfileOf(actor, userId, body)`      | `updateProfile` чужого профиля; цель — суперпользователь, актор нет → `PROFILE_SUPERUSER_EDIT`. |
| `clearProfileOf(actor, userId)`             | `deleteProfile` чужого профиля с той же проверкой (`AccessService.isSuperUser`).                |
| `toProfileDto(p)` / `toPublicProfileDto(p)` | Сборка DTO.                                                                                     |

## DTO

- **ProfileDto** — полное представление владельца: id, userId, firstName, lastName,
  birthDate, gender, locale, createdAt, updatedAt, `user?` (`UserDto`, если загружен).
- **PublicProfileDto** — id, userId, firstName, lastName.
- **IProfileListDto** — `IPaginatedDto<PublicProfileDto>`.
- **IProfileUpdateRequestDto** — firstName?, lastName?, birthDate?, gender?, locale?.

## Ошибки и права

- `ProfileError.NOT_FOUND` → `PROFILE_NOT_FOUND` (404).
- `ProfileError.SUPERUSER_EDIT` → `PROFILE_SUPERUSER_EDIT` (403).
- `ProfilePermissions` (группа «Профили», чужие профили): `profile:view` — просмотр,
  `profile:update` — изменение, `profile:delete` — очистка.

## События

| Событие               | Данные             | Когда                                                              |
| --------------------- | ------------------ | ------------------------------------------------------------------ |
| `ProfileUpdatedEvent` | `PublicProfileDto` | Обновление или очистка профиля                                     |
| `UserOnlineEvent`     | `userId`           | Первое сокет-соединение пользователя (публикует `SocketBootstrap`) |
| `UserOfflineEvent`    | `userId`           | Закрыто последнее соединение (публикует `SocketBootstrap`)         |

`UserOnlineEvent`/`UserOfflineEvent` объявлены здесь, но сейчас их никто не
слушает (рассылка присутствия удалена).

## Сокет (`ProfileListener`)

| Событие EventBus      | Socket-событие    | Получатель                          | Данные             |
| --------------------- | ----------------- | ----------------------------------- | ------------------ |
| `ProfileUpdatedEvent` | `profile:updated` | владелец (`toUser`, все устройства) | `PublicProfileDto` |

Входящих сокет-событий у модуля нет.

## Зависимости

| Зависимость            | Откуда           | Использование                         |
| ---------------------- | ---------------- | ------------------------------------- |
| `User` entity          | `modules/user`   | Связь `OneToOne` в `Profile`          |
| `EventBus`             | `core`           | Публикация `ProfileUpdatedEvent`      |
| `SocketEmitterService` | `modules/socket` | Доставка `profile:updated` в listener |

Профиль создаёт модуль user (при регистрации и засеве); `ProfileRepository`
использует `SeedBootstrap`.
