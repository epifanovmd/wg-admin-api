# Модуль Permission

Справочник прав (RBAC + permissions): сущность, репозиторий и **реестр прав модулей**.
Контроллера и module-файла нет — провайдеры регистрируются в `UserModule`.

## Структура файлов

```
src/modules/permission/
├── permission.entity.ts          # Permission (таблица permissions)
├── permission.repository.ts      # Репозиторий
├── permission.registry.ts        # definePermissions, getRegisteredPermissions
├── permission.types.ts           # Permissions (совместимый справочник), TPermission, PermissionName
├── permission.dto.ts             # IPermissionDto, IPermissionListDto
├── permission.registry.test.ts
└── index.ts
```

## Реестр прав

Модуль объявляет свои права сам — общий файл при добавлении модуля не правится:

```ts
export const ReportPermissions = definePermissions("report", {
  VIEW: "report:view",
  EXPORT: "report:export",
  ALL: "report:*",
});
```

- Каждое право — `<domain>:<действие>` (сегменты `a-z0-9-`, последний может быть `*`),
  ≤ 100 символов; чужой домен или неверный формат → `PERMISSION_INVALID_DEFINITION`
  при загрузке модуля.
- Повторное объявление тех же имён идемпотентно; объявление возвращается замороженным.
- Объявление должно быть импортировано при старте: экспортируйте его из `index.ts`
  модуля.
- `getRegisteredPermissions()` — все права: `*`, совместимый `Permissions` и
  объявленные модулями (без повторов, отсортированы). Засев
  (`RoleService.seedDefaultPermissions`) создаёт в БД каждое из них.
- `getDomainPermissions(domain)` — права домена; `unregisterPermissionDomain(domain)` —
  только для тестов.

Объявления в модулях: `UserPermissions` (user), `RolePermissions` (role),
`ProfilePermissions` (profile), `ApiKeyPermissions` (apikey), `AuditPermissions`
(audit).

Строки в `@Security("jwt", ["permission:…"])` остаются литералами: генератор
маршрутов читает декораторы статически.

## Совместимый справочник `Permissions`

`permission.types.ts` — прежний const-объект (`Permissions.ALL`, `USER_VIEW`,
`ROLE_MANAGE`, …) для существующего кода; ядро берёт из него `ALL`. Все значения входят
в реестр. Платформенные права (у `admin` — через `*`):

| Константа       | Право           |
| --------------- | --------------- |
| `APIKEY_MANAGE` | `apikey:manage` |
| `AUDIT_VIEW`    | `audit:view`    |

Новые права добавляются не сюда, а через `definePermissions` в своём модуле.

## Entity: Permission (`permissions`)

| Поле                      | Тип                    | Описание                 |
| ------------------------- | ---------------------- | ------------------------ |
| `id`                      | `uuid` (PK)            | Уникальный идентификатор |
| `name`                    | `varchar(100)`, unique | Имя права                |
| `createdAt` / `updatedAt` | `timestamptz`          | Временные метки          |

Связь: M:N → `Role` (обратная сторона, `role_permissions`).

## PermissionRepository

| Метод                | Описание                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `findByName(name)`   | Найти право по имени.                                                     |
| `findByNames(names)` | Права по списку имён (отсутствующие не попадают в результат).             |
| `findAll()`          | Все права с ролями.                                                       |
| `ensureByName(name)` | Вернуть право, создав при отсутствии (`INSERT … ON CONFLICT DO NOTHING`). |

Прямые права пользователю (`setPrivileges`) выдаются только из существующих записей;
новые права также появляются через `PATCH /api/v1/roles/{id}/permissions`.

## Проверка

Wildcard-иерархия: `*` > `user:*` > `user:view` (`core/auth/has-permission.ts`).
Эффективные права кладутся в JWT при выдаче; `@Security("jwt", ["permission:user:view"])`
проверяет их без БД.

## DTO

- **IPermissionDto** — id, name, createdAt, updatedAt
- **IPermissionListDto** — `IPaginatedDto<IPermissionDto>`

## Ошибки

`PERMISSION_INVALID_DEFINITION` (500) — некорректное объявление в `definePermissions`.

## Тесты

`permission.registry.test.ts` — регистрация, идемпотентность, формат и домен,
совместимый справочник и платформенные права в реестре.
