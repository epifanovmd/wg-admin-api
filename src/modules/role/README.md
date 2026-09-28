# Модуль Role

Роли пользователей и их права: API просмотра/создания/удаления ролей, замена набора
прав роли, идемпотентный засев ролей по умолчанию. Отдельного `role.module.ts` нет —
провайдеры регистрируются в `UserModule`.

## Структура файлов

```
src/modules/role/
├── role.entity.ts          # Role (таблица roles)
├── role.repository.ts      # findById/findByName/findByNames/findAll/ensureByName/findMemberIds
├── role.service.ts         # RoleService
├── role.controller.ts      # REST, /api/v1/roles
├── role.types.ts           # const Roles, TRole
├── role.errors.ts          # RoleError — коды ROLE_*
├── role.permissions.ts     # RolePermissions (definePermissions("role"))
├── role.dto.ts             # IRoleDto
├── role.listener.ts        # RoleListener: изменения ролей → комната roles
├── role.socket-events.ts   # role:updated, role:deleted в контракте сокета
├── dto/                    # Тела запросов
├── events/                 # RoleCreatedEvent, RoleDeletedEvent, RolePermissionsChangedEvent
└── validation/             # CreateRoleSchema, SetRolePermissionsSchema
```

## Entity: Role (`roles`)

| Поле                      | Тип                    | Описание                                                               |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `id`                      | `uuid` (PK)            |                                                                        |
| `name`                    | `varchar(100)`, unique | `TRole` — предопределённые `admin`/`user`/`guest` или произвольное имя |
| `createdAt` / `updatedAt` | `timestamptz`          |                                                                        |

Связь: M:N → `Permission` (таблица `role_permissions`).

## Endpoints (`/api/v1/roles`)

| Метод    | Путь               | Право         | Ответ        | Описание                                                 |
| -------- | ------------------ | ------------- | ------------ | -------------------------------------------------------- |
| `GET`    | `/`                | `role:view`   | `IRoleDto[]` | Все роли с правами                                       |
| `POST`   | `/`                | `role:create` | `IRoleDto`   | Создать роль; существующая → `ROLE_ALREADY_EXISTS` (409) |
| `DELETE` | `{id}`             | `role:delete` | 204          | Удалить роль (см. «Удаление»)                            |
| `PATCH`  | `{id}/permissions` | `role:update` | `IRoleDto`   | Заменить права роли                                      |

`{id}` — `UUID`.

## Удаление `deleteRole(actor, roleId)`

- Нет роли — `ROLE_NOT_FOUND` (404); системные роли `admin`/`user`/`guest` не удаляются
  (`ROLE_SYSTEM_ROLE`, 409).
- Собственную роль удаляет только суперпользователь (`ROLE_OWN_ROLE`, 403).
- Перед удалением собираются пользователи роли (`findMemberIds`); после —
  `RoleDeletedEvent` через `emitAsync` (обработчики отрабатывают до ответа).

## Правила `setRolePermissions(actor, roleId, permissions)`

- Отсутствующие права создаются (`PermissionRepository.ensureByName`).
- Роль `admin`, право `*` меняет только суперпользователь (`ROLE_SUPERUSER_ONLY`, 403),
  собственную роль — тоже (`ROLE_OWN_ROLE`, 403). Нет роли — `ROLE_NOT_FOUND` (404).
- После сохранения эмитится `RolePermissionsChangedEvent`; `UserListener` превращает его в
  `UserPrivilegesChangedEvent` для каждого пользователя роли (socket
  `user:privileges-changed`; прежние access-токены отклоняются — модуль session).

## Засев `seedDefaultPermissions()`

Вызывается `AdminBootstrap` при старте. Идемпотентен и безопасен для нескольких реплик:
все права из реестра (`getRegisteredPermissions()`: объявленные модулями через
`definePermissions`, включая `apikey:*`, `audit:view`) и роли создаются через `INSERT … ON CONFLICT DO NOTHING`;
роли, у которых уже есть права, не трогаются (ручные изменения сохраняются).

| Роль    | Права по умолчанию           |
| ------- | ---------------------------- |
| `admin` | `*`                          |
| `user`  | — (без прав модуля `user:*`) |
| `guest` | —                            |

## Ошибки (`RoleError`, коды `ROLE_*`)

| Код                   | Статус | Когда                                                  |
| --------------------- | ------ | ------------------------------------------------------ |
| `ROLE_NOT_FOUND`      | 404    | нет роли                                               |
| `ROLE_ALREADY_EXISTS` | 409    | имя занято (в т. ч. гонка создания)                    |
| `ROLE_SUPERUSER_ONLY` | 403    | изменение `admin` или выдача `*` не суперпользователем |
| `ROLE_OWN_ROLE`       | 403    | изменение прав или удаление собственной роли           |
| `ROLE_SYSTEM_ROLE`    | 409    | удаление `admin`/`user`/`guest`                        |

## Права

`RolePermissions` (группа «Роли»): `role:view` — просмотр, `role:create` — создание,
`role:update` — изменение прав роли, `role:delete` — удаление.

## События

| Событие                       | Когда                      | Поля                                |
| ----------------------------- | -------------------------- | ----------------------------------- |
| `RoleCreatedEvent`            | роль создана (без прав)    | `roleId`, `roleName`                |
| `RoleDeletedEvent`            | роль удалена (`emitAsync`) | `roleId`, `roleName`, `memberIds`   |
| `RolePermissionsChangedEvent` | набор прав роли заменён    | `roleId`, `roleName`, `permissions` |

`RoleService.getRole(roleId)` — роль с правами или `ROLE_NOT_FOUND`.

## Сокет

Комната списка ролей `roles` (`ROLES_ROOM`, `permissionRoomPolicy`, право `role:view`).
`RoleListener` (регистрируется в `UserModule` вместе с политикой):

| Событие                                           | Сокет                     |
| ------------------------------------------------- | ------------------------- |
| `RoleCreatedEvent`, `RolePermissionsChangedEvent` | `role:updated` (IRoleDto) |
| `RoleDeletedEvent`                                | `role:deleted { id }`     |

## Зависимости

`RoleRepository`, `PermissionRepository`, `EventBus`; `isSuperUser` из `core`.
