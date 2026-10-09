# Модуль wg-node

Корень WG-домена: ноды (VPS с агентом), их агенты (привязка, установка, состояние,
журнал, обновления, запросы к воркеру wg), общие сервисы домена
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
  удаление, команда установки, привязка и обновление агента и воркеров, журнал агента,
  установка/удаление агента
  по SSH, назначение и снятие владельца.
- `wg:node:create` — создание (без области); создатель — автор запроса.
  Владелец при создании (`ownerId`), отличный от себя, — только с правом
  назначения (любая область).
- Проверка для других модулей домена — `WgNodeService.findFor(actor, id,
permission)` и `viewFilter(actor)`; методы без актора (`findEntity`,
  `markDirty`, …) — внутренние, без проверки прав.

Агент ноды доступен через модуль agent тем, у кого есть право на ноду
(`WgNodeAgentAccessPolicy`, `AGENT_ACCESS_POLICY`): `wg:node:view` — просмотр,
`wg:node:logs` — журнал, `wg:node:agent` — действия, настройки и запросы к воркерам.

## Модель

- **WgNode** (`wg_nodes`) — VPS с установленным агентом; `ownerId` —
  назначенный владелец, `createdById` — создатель (оба FK users SET NULL). Желаемая
  конфигурация версионируется: `configVersion` растёт при любом изменении домена
  (`WgNodeService.markDirty`, вызывается в транзакции изменения); модуль wg-agent
  отдаёт её воркеру wg настройкой `state`, итог применения даёт `appliedVersion` и
  `applyError` (`inSync` — применённая версия не меньше желаемой).
- **Агент** — `agentId` (уникален; id агента в модуле agent). Привязка — при
  регистрации агента (`AgentEnrolledEvent`, `WgNodeAgentListener`): метка `nodeId`
  одноразового токена установки; при общем токене окружения — метка `nodeId` самого
  агента; без метки — нода без агента с тем же именем; иначе агент остаётся без ноды
  (привязка вручную). Новый агент ноды — прежний отзывается, нода получает новую версию.
  Агент удалён — нода без агента (`created`); нода удалена — её агент отзывается и
  удаляется.
- **Статус** (`status`, `statusMessage`) — по записи агента (`AgentUpdatedEvent`,
  `wgNodeStatusOf`): нет агента или отозван — `created`, без связи — `offline`, воркер
  wg или socks не зарегистрирован, упал или не в порядке — `error` с пояснением, иначе
  `online`; `provisioning` и `error` ставит ещё установка по SSH. Оттуда же
  `agentVersion`, `agentRemoteIp`, `lastSeenAt`, ОС (`osInfo`: узел — от агента, режим wg,
  дистрибутив и занятые порты — из `health.info` воркера wg) и `wgVersion`; пишутся
  только изменившиеся колонки.

## Эндпоинты (`/api/v1/wg/nodes`, тег WgNode)

Фильтр «Мои»: `GET /` и `GET /options` принимают `mine=true` — только свои ноды (владелец
или создатель) при любой области права (`OwnedAccess.listFilter`). DTO несёт
`ownerName` и `createdByName` — отображаемые имена владельца и создателя
(`userDisplayName` модуля user — то же, что `name` в `GET /api/v1/user/options`);
пользователи присоединяются join-ом (`joinUserName`) в `findPage`, `findWithOwners` и `findManyWithOwners`, поэтому те же
поля — и в событии `wg:node:updated`.

| Метод  | Путь                             | Право                                                                    |
| ------ | -------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/`                              | `wg:node:create` (ответ — нода и `install`: команда установки с токеном) |
| GET    | `/`, `/options`, `/{id}`         | `wg:node:view[:own]`                                                     |
| PATCH  | `/{id}`                          | `wg:node:update[:own]`                                                   |
| DELETE | `/{id}`                          | `wg:node:delete[:own]` (при интерфейсах — 409)                           |
| POST   | `/{id}/assign`                   | `wg:node:assign[:own]` — `{ userId }`, владелец                          |
| POST   | `/{id}/revoke`                   | `wg:node:assign[:own]` — снять владельца                                 |
| POST   | `/{id}/install-command`          | `wg:node:agent[:own]` — токен и команда установки агента                 |
| POST   | `/{id}/agent`                    | `wg:node:agent[:own]` — `{ agentId }`, привязка агента                   |
| POST   | `/{id}/agent/update`             | `wg:node:agent[:own]` — обновить агента до новой версии                  |
| POST   | `/{id}/workers/{worker}/update`  | `wg:node:agent[:own]` — обновить воркер с сервера                        |
| POST   | `/{id}/workers/{worker}/restart` | `wg:node:agent[:own]` — перезапустить воркер                             |
| GET    | `/{id}/logs?lines&worker`        | `wg:node:logs[:own]` — журнал агента или воркера с узла                  |

Команда установки (`WgNodeAgentService.commandFor`): `curl -fsSL <AGENT_PUBLIC_URL или
APP_PUBLIC_URL>/api/v1/agent-link/install.sh | sudo sh -s -- --instance wg --token … --name
<нода> --privileged --packages … --sysctl net.ipv4.ip_forward=1 --sysctl
net.ipv6.conf.all.forwarding=1 --worker wg --worker socks` (экземпляр — `AGENT_INSTANCE`,
пакеты — по менеджерам). Токен — одноразовый, с меткой ноды, сутки (10 минут — 30 дней,
`expiresInMinutes`). Перезапуск интерфейса (модуль wg-interface) —
`WgNodeAgentService.restartInterface`: запрос `POST /interfaces/{name}/restart` к воркеру
wg основной ноды, итог — сразу; нет агента — 409 `WG_NODE_NO_AGENT`, отказ воркера — 502
`WG_NODE_WORKER_FAILED`, агент без связи — 503 `AGENT_OFFLINE`. `wg:node:provision` —
установка и удаление агента по SSH (модуль wg-provision), с той же областью.

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

`WG_SECRETS_KEY` (обязателен в production), `WG_STATS_*_RETENTION_*`,
`WG_NODE_METRIC_RETENTION_DAYS`, `WG_RELAY_TUNNEL_CIDR`. Агенты — `AGENT_*` (модуль agent).
