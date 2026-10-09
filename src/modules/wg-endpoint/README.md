# Модуль wg-endpoint

Точки подключения — стабильные адреса, которые попадают в клиентские конфиги
(`Endpoint = host:port`). Отвязывают адрес подключения от адреса WG-ноды:
ноду можно переносить или менять, не пересоздавая конфиги клиентов.

## Режимы

- **direct** — `host` указывает на саму ноду (стабильный DNS/anycast-IP);
  системой не обслуживается, просто подставляется в конфиги.
- **relay** — `host` обслуживает релей-нода (`relayNodeId`, обычная нода с
  агентом, например VPS бэкенда). Агент релея настраивает проброс UDP до
  целевой ноды интерфейса:
  - `forwardMode=dnat` — iptables DNAT на публичный адрес целевой ноды;
  - `forwardMode=ipip` — IPIP-туннель (обход потерь и фильтрации UDP на
    пути у хостера) + DNAT внутрь туннеля.
  - `route` (только для `ipip`): `auto` — у каждой копии интерфейса туннель,
    затем её прямой адрес (лёг только туннель — клиенты остаются на ноде),
    нода недоступна целиком — следующая копия; `tunnel` — только туннели;
    `direct` — только прямые адреса.

## Доступ

Действия над точкой — с областью (`scoped`): право на все точки или `…:own` —
только на свои. Своя точка — где пользователь назначенный владелец (`ownerId`)
или создатель (`createdById`); проверки — `WgEndpointAccess` (`OwnedAccess`
ядра). Невидимая точка по id — 404, видимая без права на действие — 403
`WG_ENDPOINT_FORBIDDEN`; списки и options ограничены областью
`wg:endpoint:view`.

- `wg:endpoint:create` — без области; создатель — автор запроса, владелец
  (`ownerId`), отличный от себя, — только с правом назначения.
- Релей-нода при создании и при смене релея должна быть видна автору
  (`wg:node:view[:own]`), иначе 404 `WG_ENDPOINT_RELAY_NODE_NOT_FOUND`; прежний
  релей при изменении других полей не перепроверяется.
- Интерфейс подключается только к видимой автору точке
  (`WgEndpointService.findFor(actor, id, wg:endpoint:view)` в wg-interface).
- Методы без актора (`findEntity`, линки, `publishInterfacesChanged`) —
  внутренние.
- `WgEndpointDto.interfaces` перечисляет все интерфейсы точки, без фильтра по
  правам просматривающего.

## Модель

- **WgEndpoint** (`wg_endpoints`) — ownerId (владелец), createdById
  (создатель; оба FK users SET NULL), name (unique), host, mode, relayNodeId
  (FK RESTRICT), forwardMode, route (`auto` по умолчанию).
- **WgRelayLink** (`wg_relay_links`) — линк (relayNode, targetNode) с
  уникальным `tunnelIndex`: /30-блок в `WG_RELAY_TUNNEL_CIDR`
  (по умолчанию `10.99.0.0/16`), имя туннеля `wgt<index>`, адреса концов —
  `relay-tunnel.ts`. Линки создаёт/освобождает модуль wg-interface
  (`WgRelaySyncService`) по фактическому использованию.

Релей не обслуживает точку для собственных интерфейсов (туннель сам в себя):
смена релея на ноду, чьи интерфейсы используют точку, — 409
`WG_ENDPOINT_RELAY_IS_TARGET`. Кто использует точку, модуль узнаёт через
multi-inject `WG_ENDPOINT_USAGE` (`asWgEndpointUsage`, реализует wg-interface).
Смена релея, на котором порты интерфейсов точки уже заняты, — 409
`WG_ENDPOINT_RELAY_PORT_CONFLICT`.

## Эндпоинты (`/api/v1/wg/endpoints`, тег WgEndpoint)

Фильтр «Мои»: `GET /` и `GET /options` принимают `mine=true` — только свои точки (владелец
или создатель) при любой области права (`OwnedAccess.listFilter`). DTO несёт
`ownerName` и `createdByName` — отображаемые имена владельца и создателя
(`userDisplayName` модуля user — то же, что `name` в `GET /api/v1/user/options`);
пользователи присоединяются join-ом (`joinUserName`) в `findPage`, `findWithOwners` и `findManyWithOwners`, поэтому те же
поля — и в событии `wg:endpoint:updated`.

`WgEndpointDto.interfaces` — интерфейсы, подключённые через точку (нода,
порт клиентов, ноды копий): куда она ведёт. Данные — от модуля интерфейсов
через `IWgEndpointUsage.interfacesByEndpoint` (один запрос на список точек).

CRUD + options и `POST {id}/assign` `{ userId }` / `POST {id}/revoke` —
владелец; права `wg:endpoint:view[:own]` (чтение), `wg:endpoint:create`,
`wg:endpoint:update[:own]`, `wg:endpoint:delete[:own]`,
`wg:endpoint:assign[:own]`.
Удаление используемой точки — 409 (FK RESTRICT от интерфейсов).

## События

`WgEndpointUpdatedEvent(dto, previous)` — при изменении host/mode/relay/
forwardMode/route; модуль wg-interface пересинхронизирует линки и поднимает
версии конфигурации затронутых нод. `WgEndpointChangedEvent(dto)` — при любом
сохранении (в том числе названия и описания), для UI; при назначении и снятии
владельца несёт `previousOwnerId` (прежний, если сменился).

Сокет: комната `wg-endpoints` (право `wg:endpoint:view` — на все точки) —
`wg:endpoint:updated` (создание, любое изменение и изменение её интерфейсов —
`WgEndpointInterfacesChangedEvent`, только для UI), `wg:endpoint:deleted`. Те же
события — своим (владельцу и создателю с областью `own`,
`OwnedEntityEmitter.toOwners`); прежний владелец, если он не создатель, получает
`wg:endpoint:deleted` (`detach`). Комнаты отдельной точки нет.
Изменение точки (`WgEndpointChangedEvent`) заново рассылает DTO её интерфейсов
(в них — `endpoint`: имя, режим, релей).
