# Модуль wg-interface

WireGuard-интерфейсы нод. Желаемое состояние живёт в БД (приватный ключ —
шифрованный), применяет его агент ноды по версии конфигурации; фактический
статус (`up/down/error/unknown`) агент сообщает обратно.

## Модель

**WgInterface** (`wg_interfaces`): nodeId (FK RESTRICT), name (unique на
ноде, `^[a-zA-Z0-9_=+.-]{1,15}$`), listenPort (unique на ноде), addressCidr
(+ addressV6Cidr), ключи, dns/mtu (дефолты клиентов), endpointId → точка
подключения (`wg-endpoint`) + endpointPort, natEnabled (пресет masquerade),
customPostUp/Down (право `wg:interface:hooks`), enabled, status/statusMessage.

Адрес подключения клиентов: `endpoint.host:endpointPort ?? listenPort`,
иначе `node.publicHost:listenPort` (`resolveClientEndpoint`).

## Эндпоинты (`/api/v1/wg/interfaces`, тег WgInterface)

Список (`GET /`) — с копиями; фильтры `nodeId` (основная нода),
`hostNodeId` (где интерфейс работает: основная или копия), `endpointId`, `viaRelay`
(только интерфейсы за точками через релей — что и куда пересылают релеи),
`enabled`, `query`.

| Право                   | Что даёт                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `wg:interface:view`     | `GET /`, `/options`, `/{id}`                                                           |
| `wg:interface:create`   | `POST /`                                                                               |
| `wg:interface:update`   | `PATCH /{id}`                                                                          |
| `wg:interface:delete`   | `DELETE /{id}`                                                                         |
| `wg:interface:control`  | `POST {id}/enable\|disable` (желаемое состояние), `POST {id}/restart` (команда агенту) |
| `wg:interface:move`     | `POST {id}/move`                                                                       |
| `wg:interface:replicas` | `POST {id}/replicas`, `DELETE {id}/replicas/{nodeId}`                                  |
| `wg:interface:hooks`    | задавать `customPostUp`/`customPostDown` при создании и изменении                      |

Без `wg:interface:hooks` (и не суперпользователь) тело с произвольными
PostUp/PostDown — 403 `WG_IFACE_CUSTOM_HOOKS_FORBIDDEN`. Удаление с пирами —
409; конфликты имени/порта/порта точки — 409.

Сервисы: `WgInterfaceService` — CRUD, перенос, включение, статусы;
`WgInterfaceReplicaService` — реплики и копия, обслуживающая трафик релея;
`WgInterfaceGuard` — проверки размещения (имя и порт на ноде, порт точки,
порты релея, пробросы других модулей).

## Релей-линки

`WgRelaySyncService.syncRelay(relayNodeId)` — идемпотентно приводит линки
(IPIP /30) к фактическому использованию и поднимает версии затронутых нод.
Вызывается после изменений интерфейсов и по `WgEndpointUpdatedEvent`
(listener), там же — bump версий нод, чьи интерфейсы затронуты сменой точки.

## Сокет

Комнаты: `wg-interfaces` — список (`permissionRoomPolicy`, `wg:interface:view`),
`wg-interface_<id>` — страница интерфейса (policy `wg-interface`, `wg:interface:view`).
`WgInterfaceListener` шлёт `wg:interface:updated` (DTO) и `wg:interface:deleted {id}`
в `wg-interfaces` и `wg-interface_<id>`; в комнаты нод и `wg-overview` изменения
интерфейсов не идут. Статистика (`wg:interface:stats`, `wg:peers:stats`) — модуль wg-stats.

Интерфейс нельзя подключить через точку, чей релей — его же нода: 409
`WG_IFACE_ENDPOINT_RELAY_IS_NODE`. Такие пары (если остались в данных) не
считаются целями релея и не дают линков. Для wg-endpoint модуль регистрирует
`asWgEndpointUsage(WgInterfaceEndpointUsage)` — ноды интерфейсов точки.

UDP-порты релей-ноды общие для её relay-точек и собственных интерфейсов:
порт проброса (`endpointPort ?? listenPort`) не может совпадать с портом
другой точки того же релея или с listen-портом интерфейса релея — 409
`WG_IFACE_RELAY_PORT_TAKEN`; listen-порт интерфейса не может быть занят
пробросом этой же ноды как релея — 409 `WG_IFACE_PORT_FORWARDED`.

Перенос на другую ноду — `POST /api/v1/wg/interfaces/{id}/move` (право
`wg:interface:move`): ключ и пиры сохраняются, обе ноды получают новую
версию конфигурации, релей точки пересинхронизирует линк. С точкой
подключения клиентские конфиги не меняются. Проверки — как при изменении
(уникальность имени/порта на ноде, релей ≠ нода, порты релея); на ту же
ноду — 400 `WG_IFACE_MOVE_SAME_NODE`.

Порт проброса, который по последнему отчёту агента релея слушает другой
процесс на его хосте (`osInfo.udpPorts`), — 409 `WG_IFACE_RELAY_PORT_BUSY`
(и при смене релея точки).

## Реплики

Интерфейс может иметь копии на других нодах (право `wg:interface:replicas`) (`WgInterfaceReplica`,
`wg_interface_replicas`): тот же ключ, адреса и всегда тот же набор пиров —
любое изменение интерфейса или его пиров поднимает версию всех копий
(`markInterfaceDirty`). Имя и порт проверяются на ноде с учётом реплик чужих
интерфейсов (индексы БД видят только основные ноды).

- `POST /api/v1/wg/interfaces/{id}/replicas` `{ nodeId }` — копия (409:
  повтор, релей точки, порт/имя заняты; 400 — основная нода);
- `DELETE /api/v1/wg/interfaces/{id}/replicas/{nodeId}` — убрать;
- `PATCH` интерфейса `activeReplicaNodeId` — закрепить трафик через релей на
  копии (основная или реплика); `null` — авто.

Релей точки держит туннели до всех копий (цели линков включают реплики) и
получает для проброса кандидатов по приоритету (основная — первой;
закреплённая — единственный). Реплика — кандидат, только когда агент её
ноды отчитался `up`: нода без агента или с ошибкой интерфейса отвечает на
пинг, но трафика там не обслужить. Смена статуса реплики в `up` и из него
поднимает версию релея. Агент релея берёт первого живого кандидата
(по пробам туннелей или пингу адреса) и сообщает `activeNodeId` —
`servingNodeId` интерфейса (пишется при смене, с событием). Перенос на ноду,
где есть реплика, — 409 `WG_IFACE_MOVE_TO_REPLICA`.
