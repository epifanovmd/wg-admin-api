# Модуль wg-node

Корень WG-домена: ноды (VPS с агентом), команды агентам, общие сервисы домена
(шифрование секретов, генерация ключей WireGuard, проверка прав по userId,
конфигурация `wg.config.ts`).

## Доступ

Действия над нодой — с областью (`scoped`): право на все ноды или `…:own` —
только на свои. Своя нода — где пользователь назначенный владелец (`ownerId`)
или создатель (`createdById`); проверки — `WgNodeAccess` (`OwnedAccess` ядра).

- `wg:node:view[:own]` — просмотр и метрики. С `:own` списки и options
  ограничиваются своими нодами; невидимая нода по id — 404, видимая без права на
  действие — 403.
- `wg:node:update|delete|agent|logs|provision|assign[:own]` — изменение,
  удаление, ключ и обновление агента, журнал агента, установка/удаление агента
  по SSH, назначение и снятие владельца.
- `wg:node:create` — создание (без области); создатель — автор запроса.
  Владелец при создании (`ownerId`), отличный от себя, — только с правом
  назначения (любая область).
- Проверка для других модулей домена — `WgNodeService.findFor(actor, id,
permission)` и `viewFilter(actor)`; методы без актора (`findEntity`,
  `reissueAgentKey`, `markDirty`, …) — внутренние, без проверки прав.

Ключ агента — api-key со scope `wg-agent:<nodeId>`, владелец ключа — тот, кто
его выпустил; доступ агента от прав пользователей не зависит.

## Модель

- **WgNode** (`wg_nodes`) — VPS с установленным агентом; `ownerId` —
  назначенный владелец, `createdById` — создатель (оба FK users SET NULL). Желаемая конфигурация
  версионируется: `configVersion` растёт при любом изменении домена
  (`WgNodeService.markDirty`, вызывается в транзакции изменения), агент
  применяет её и сообщает `appliedVersion`/`applyError`. `status`:
  `created | provisioning | online | offline | error` — живость агента
  (`lastSeenAt`, cron `wg.node-offline`). Ключ агента — api-key со scope
  `wg-agent:<nodeId>` (`agentKeyId`), выдаётся при создании ноды и при ротации,
  секрет возвращается один раз.
- **WgNodeCommand** (`wg_node_commands`) — императивные команды агенту из
  фиксированного набора: `interface-restart`, `agent-logs`, `agent-update`.
  Статусы
  `pending → running → succeeded | failed | timeout`; вывод копится в `output`
  (предел `WG_COMMAND_OUTPUT_MAX_BYTES`). Агент берёт и завершает только
  команды своей ноды.

## Эндпоинты (`/api/v1/wg/nodes`, тег WgNode)

Фильтр «Мои»: `GET /` и `GET /options` принимают `mine=true` — только свои ноды (владелец
или создатель) при любой области права (`OwnedAccess.listFilter`). DTO несёт
`ownerName` и `createdByName` — отображаемые имена владельца и создателя
(`userDisplayName` модуля user — то же, что `name` в `GET /api/v1/user/options`);
пользователи присоединяются join-ом (`joinUserName`) в `findPage`, `findWithOwners` и `findManyWithOwners`, поэтому те же
поля — и в событии `wg:node:updated`.

| Метод  | Путь                     | Право                                                   |
| ------ | ------------------------ | ------------------------------------------------------- |
| POST   | `/`                      | `wg:node:create` (ответ содержит `agentKey` — один раз) |
| GET    | `/`, `/options`, `/{id}` | `wg:node:view[:own]`                                    |
| PATCH  | `/{id}`                  | `wg:node:update[:own]`                                  |
| DELETE | `/{id}`                  | `wg:node:delete[:own]` (при интерфейсах — 409)          |
| POST   | `/{id}/assign`           | `wg:node:assign[:own]` — `{ userId }`, владелец         |
| POST   | `/{id}/revoke`           | `wg:node:assign[:own]` — снять владельца                |
| POST   | `/{id}/agent-key`        | `wg:node:agent[:own]` — ротация ключа агента            |
| GET    | `/{id}/logs`             | `wg:node:logs[:own]` — журнал агента (синхронно)        |

`wg:node:agent` также даёт обновление агента (модуль wg-agent), `wg:node:provision` —
установку и удаление агента по SSH (модуль wg-provision); оба — с той же областью.

## Сокет

Вход в комнаты — по актуальным правам из БД через `AccessService` ядра.

- `wg-nodes` — список нод (`permissionRoomPolicy`, `wg:node:view` — на все);
- `wg-node_<id>` — страница ноды (policy `wg-node`: право на все или своя нода
  с `wg:node:view:own`).

`WgNodeListener`:

| Событие                                          | Сокет                   | Куда                                                |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------- |
| `WgNodeCreatedEvent`                             | `wg:node:updated` (DTO) | `wg-nodes`, своим (`OwnedEntityEmitter.toOwners`)   |
| `WgNodeUpdatedEvent`, `WgNodeStatusChangedEvent` | `wg:node:updated` (DTO) | `wg-nodes`, `wg-node_<id>`, своим                   |
| `WgNodeUpdatedEvent` с `previousOwnerId`         | `wg:node:deleted {id}`  | прежнему владельцу, если он не создатель (`detach`) |
| `WgNodeDeletedEvent`                             | `wg:node:deleted {id}`  | `wg-nodes`, `wg-node_<id>`, своим                   |

«Своим» — владельцу и создателю с областью `own` права просмотра; с правом на
все события приходят через комнату списка. `WgNodeUpdatedEvent(node,
previousOwnerId)`: `assign`/`revoke` передают прежнего владельца, если он
сменился.

В `wg-node_<id>` также идут `wg:node:stats`, `wg:node:links` (wg-stats) и `job:updated`
задач установки агента (scope ноды, wg-provision). Константа `WG_OVERVIEW_ROOM`
объявлена здесь, комната — модуля wg-stats (только статистика).

## Общие сервисы домена

- `WgSecretBox` — AES-256-GCM для приватных ключей/PSK/SSH-ключей в БД
  (ключ `WG_SECRETS_KEY`, в dev/test — производный).
- `wg-keys.ts` — генерация ключей WireGuard (X25519 через `node:crypto`,
  без вызова `wg`), PSK.
- `validation/wg-shared.validate.ts` — общие Zod-схемы домена (хосты, CIDR,
  AllowedIPs, DNS) — всё, что попадает в конфиги, валидируется строго.

## Конфигурация (`wg.config.ts`, секция `wg`)

`WG_SECRETS_KEY` (обязателен в production), `WG_AGENT_POLL_WAIT_MS`,
`WG_AGENT_OFFLINE_AFTER_SEC`, `WG_COMMAND_TIMEOUT_SEC`, `WG_COMMAND_*`,
`WG_STATS_*_RETENTION_*`, `WG_NODE_METRIC_RETENTION_DAYS`.
