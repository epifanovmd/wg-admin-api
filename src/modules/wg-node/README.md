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
  удаление, команда установки, привязка агента и действия с ним, журнал агента,
  установка/удаление агента по SSH, назначение и снятие владельца.
- `wg:node:create` — создание (без области); создатель — автор запроса.
  Владелец при создании (`ownerId`), отличный от себя, — только с правом
  назначения (любая область).
- Проверка для других модулей домена — `WgNodeService.findFor(actor, id,
permission)` и `viewFilter(actor)`; методы без актора (`findEntity`,
  `markDirty`, …) — внутренние, без проверки прав.

Агент ноды доступен через маршруты модуля agent (`/api/v1/agents/{id}`) тем, у кого есть право
на ноду (`WgNodeAgentAccessPolicy`, `AGENT_ACCESS_POLICY`): `wg:node:view` — просмотр,
`wg:node:logs` — журнал, `wg:node:agent` — действия (обновление агента и воркеров, перезапуск,
смена ключа), настройки и команды воркерам.

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
  `agentVersion`, `agentRemoteIp`, `lastSeenAt` и ОС (`osInfo`: узел — от агента,
  `osInfoWithHost`; режим wg, дистрибутив, ядро и занятые порты — событием `node.info`
  воркера wg, `osInfoWithWorker`, вместе с `wgVersion`); одни сведения не затирают другие,
  пишутся только изменившиеся колонки (jsonb сравнивается без учёта порядка ключей).

## Эндпоинты (`/api/v1/wg/nodes`, тег WgNode)

Фильтр «Мои»: `GET /` и `GET /options` принимают `mine=true` — только свои ноды (владелец
или создатель) при любой области права (`OwnedAccess.listFilter`). DTO несёт
`ownerName` и `createdByName` — отображаемые имена владельца и создателя
(`userDisplayName` модуля user — то же, что `name` в `GET /api/v1/user/options`);
пользователи присоединяются join-ом (`joinUserName`) в `findPage`, `findWithOwners` и `findManyWithOwners`, поэтому те же
поля — и в событии `wg:node:updated`.

| Метод  | Путь                        | Право                                                                    |
| ------ | --------------------------- | ------------------------------------------------------------------------ |
| POST   | `/`                         | `wg:node:create` (ответ — нода и `install`: команда установки с токеном) |
| GET    | `/`, `/options`, `/{id}`    | `wg:node:view[:own]`                                                     |
| PATCH  | `/{id}`                     | `wg:node:update[:own]`                                                   |
| DELETE | `/{id}`                     | `wg:node:delete[:own]` (при интерфейсах — 409)                           |
| POST   | `/{id}/assign`              | `wg:node:assign[:own]` — `{ userId }`, владелец                          |
| POST   | `/{id}/revoke`              | `wg:node:assign[:own]` — снять владельца                                 |
| POST   | `/{id}/install-command`     | `wg:node:agent[:own]` — токен и команда установки агента                 |
| POST   | `/{id}/agent/issue/env`     | `wg:node:agent[:own]` — `.env` агента ноды (токен — только в ответе)     |
| POST   | `/{id}/agent/issue/archive` | `wg:node:agent[:own]` — архив агента (все платформы) с этим `.env`       |
| POST   | `/{id}/agent/issue/link`    | `wg:node:agent[:own]` — одноразовая ссылка на такой архив                |
| POST   | `/{id}/agent`               | `wg:node:agent[:own]` — `{ agentId }`, привязка агента                   |

Журнал, обновление агента и воркеров, перезапуск воркера — маршруты агента
(`/api/v1/agents/{agentId}/…`, модуль agent) с правами ноды.

Команда установки (`WgNodeAgentService.commandFor`): `curl -fsSL '<AGENT_PUBLIC_URL или
APP_PUBLIC_URL>/agent/v1/bundle/install.sh' | sudo sh -s -- --server '<API>' --bundle
'<API>/agent/v1/bundle/agent.tar.gz' --token '<токен>' --name '<нода>'` —
установщик агента ставит архив папки агента (`agent pack`, все платформы). `mode: docker` —
архив, `.env` (0600) и `docker compose up -d --build` (контейнер в сети узла; нет `compose.yml`
в архиве — 409, токен отзывается). Экземпляр `wg`
(`WG_AGENT_INSTANCE`, как `instance` в `agent/agent.prod.yaml`), воркеры wg и socks, права
root, пакеты и параметры ядра задаёт `agent/agent.prod.yaml` архива, флагов для них в
команде нет. На ноде — служба `agent-wg`, `/opt/agent-wg/bin/agent`, `/etc/agent-wg`,
`/var/lib/agent-wg`. Токен — одноразовый, с меткой ноды, сутки (10 минут — 30 дней,
`expiresInMinutes`). Выдача (`agent/issue/*`) — то же для получателя, который запустит агента
сам: `.env` (адрес, одноразовый токен с меткой ноды, имя агента — заданное или имя ноды), архив с
ним или одноразовая ссылка на архив (`AgentIssueService` ядра). Перезапуск интерфейса (модуль wg-interface) —
`WgNodeAgentService.restartInterface`: команда `interface.restart` воркеру wg основной ноды,
итог — в ответе (ждёт до 100 с); нет агента — 409 `WG_NODE_NO_AGENT`, агент без связи — сразу
503 `AGENT_OFFLINE`, отказ воркера — 502 `WG_NODE_WORKER_FAILED` с его текстом, итога нет в
срок — 504 `AGENT_TIMEOUT`. `wg:node:provision` —
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
