# Модуль Permission

Справочник прав (RBAC + permissions): сущность, репозиторий, **реестр прав модулей** и
каталог прав с подписями. Module-файла нет — провайдеры (включая `PermissionController`)
регистрируются в `UserModule`.

## Структура файлов

```
src/modules/permission/
├── permission.entity.ts          # Permission (таблица permissions)
├── permission.repository.ts      # Репозиторий
├── permission.registry.ts        # definePermissions, getRegisteredPermissions, getPermissionCatalog
├── permission.controller.ts      # GET /api/v1/permissions — каталог прав
├── permission.types.ts           # TPermission, PermissionName
├── permission.dto.ts             # IPermissionDto, IPermissionListDto, IPermissionCatalogDto
├── permission.registry.test.ts
└── index.ts
```

## Реестр прав

Модуль объявляет свои права сам — группой с подписью; общий файл при добавлении модуля
не правится:

```ts
export const ReportPermissions = definePermissions(
  "report",
  { key: "report", label: "Отчёты" },
  {
    VIEW: { name: "report:view", label: "Просмотр" },
    EXPORT: { name: "report:export", label: "Выгрузка" },
  },
);
```

- Ключ группы — `<domain>` или `<domain>:<сущность>`; каждое право —
  `<ключ группы>:<действие>` (сегменты `a-z0-9-`, последний может быть `*`),
  ≤ 100 символов; чужой домен, пустая подпись группы или неверный формат →
  `PERMISSION_INVALID_DEFINITION` при загрузке модуля.
- Возвращается замороженный объект `KEY → имя права`.
- Повторное объявление тех же имён идемпотентно; подпись — последняя объявленная.
- Объявление должно быть импортировано при старте: экспортируйте его из `index.ts`
  модуля.
- `getRegisteredPermissions()` — все права: `*` и объявленные модулями (без повторов,
  отсортированы). Засев (`RoleService.seedDefaultPermissions`) создаёт в БД каждое из
  них.
- `getPermissionCatalog()` — группы в порядке объявления, права с подписями; первая
  группа — `*` «Система» (полный доступ).
- `getDomainPermissions(domain)` — права домена; `unregisterPermissionDomain(domain)` —
  только для тестов.

`TPermission` — строка `domain:action` (или `domain:*`); закрытого перечня прав в коде
нет.

Объявления в модулях: `UserPermissions` (user), `RolePermissions` (role),
`ProfilePermissions` (profile), `ApiKeyPermissions` (apikey), `AuditPermissions`
(audit) и права `wg:*` в модулях wg-\*.

Строки в `@Security("jwt", ["permission:…"])` остаются литералами: генератор
маршрутов читает декораторы статически. Тест `src/routing/spec.test.ts` проверяет, что
каждое `permission:`-право в спецификации объявлено в реестре.

## REST: `/api/v1/permissions`

| Метод | Путь | Доступ | Ответ                   | Описание                                              |
| ----- | ---- | ------ | ----------------------- | ----------------------------------------------------- |
| `GET` | `/`  | jwt    | `IPermissionCatalogDto` | Каталог прав по группам — для редакторов ролей и прав |

Ответ: `{ groups: [{ key, label, permissions: [{ name, label }] }] }`.

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
проверяет их без БД. После смены прав пользователя его access-токены, выданные раньше,
отклоняются с `AUTH_PRIVILEGES_CHANGED` (401) — клиент обновляет токен. Места без
HTTP-контекста (политики сокет-комнат, слушатели) проверяют права по userId из БД через
`AccessService` ядра (`core/auth/access.ts`).

## DTO

- **IPermissionDto** — id, name, createdAt, updatedAt
- **IPermissionListDto** — `IPaginatedDto<IPermissionDto>`
- **IPermissionCatalogDto** — `{ groups: IPermissionCatalogGroupDto[] }`; группа —
  `key`, `label`, `permissions: { name, label }[]`

## Ошибки

`PERMISSION_INVALID_DEFINITION` (500) — некорректное объявление в `definePermissions`.

## Тесты

`permission.registry.test.ts` — регистрация, идемпотентность, формат и домен, группы и
подписи каталога.
