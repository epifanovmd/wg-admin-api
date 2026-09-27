# Модуль Role

Роли пользователей и их права: API просмотра/создания/удаления ролей, замена набора
прав роли, идемпотентный засев ролей по умолчанию. Отдельного `role.module.ts` нет —
провайдеры регистрируются в `UserModule`.

## Структура файлов

```
src/modules/role/
├── role.entity.ts          # Role (таблица roles)
├── role.repository.ts      # findById/findByName/findByNames/findAll/ensureByName
├── role.service.ts         # RoleService
├── role.controller.ts      # REST, /api/v1/roles
├── role.types.ts           # const Roles, TRole
├── role.errors.ts          # RoleError — коды ROLE_*
├── role.permissions.ts     # RolePermissions (definePermissions("role"))
├── role.dto.ts             # IRoleDto
├── dto/                    # Тела запросов
├── events/                 # RolePermissionsChangedEvent
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
| `POST`   | `/`                | `role:manage` | `IRoleDto`   | Создать роль; существующая → `ROLE_ALREADY_EXISTS` (409) |
| `DELETE` | `{id}`             | `role:manage` | 204          | Удалить роль                                             |
| `PATCH`  | `{id}/permissions` | `role:manage` | `IRoleDto`   | Заменить права роли                                      |

`{id}` — `UUID`.

## Правила `setRolePermissions(actor, roleId, permissions)`

- Отсутствующие права создаются (`PermissionRepository.ensureByName`).
- Роль `admin`, право `*` меняет только суперпользователь (`ROLE_SUPERUSER_ONLY`, 403),
  собственную роль — тоже (`ROLE_OWN_ROLE`, 403). Нет роли — `ROLE_NOT_FOUND` (404).
- После сохранения эмитится `RolePermissionsChangedEvent`; `UserListener` превращает его в
  `UserPrivilegesChangedEvent` для каждого пользователя роли (socket
  `user:privileges-changed`, завершение сессий — модуль session).

## Засев `seedDefaultPermissions()`

Вызывается `AdminBootstrap` при старте. Идемпотентен и безопасен для нескольких реплик:
все права из реестра (`getRegisteredPermissions()`: объявленные модулями через
`definePermissions` и совместимый `Permissions`, включая `apikey:manage`,
`audit:view`) и роли создаются через `INSERT … ON CONFLICT DO NOTHING`;
роли, у которых уже есть права, не трогаются (ручные изменения сохраняются).

| Роль    | Права по умолчанию                  |
| ------- | ----------------------------------- |
| `admin` | `*`                                 |
| `user`  | — (без `user:view` / `user:manage`) |
| `guest` | —                                   |

## Ошибки (`RoleError`, коды `ROLE_*`)

| Код                   | Статус | Когда                                                  |
| --------------------- | ------ | ------------------------------------------------------ |
| `ROLE_NOT_FOUND`      | 404    | нет роли                                               |
| `ROLE_ALREADY_EXISTS` | 409    | имя занято (в т. ч. гонка создания)                    |
| `ROLE_SUPERUSER_ONLY` | 403    | изменение `admin` или выдача `*` не суперпользователем |
| `ROLE_OWN_ROLE`       | 403    | изменение прав собственной роли                        |

## Права

`RolePermissions = definePermissions("role", { VIEW: "role:view", MANAGE: "role:manage" })`.

## События

| Событие                       | Когда                   | Поля                                |
| ----------------------------- | ----------------------- | ----------------------------------- |
| `RolePermissionsChangedEvent` | набор прав роли заменён | `roleId`, `roleName`, `permissions` |

## Зависимости

`RoleRepository`, `PermissionRepository`, `EventBus`; `isSuperUser` из `core`.
