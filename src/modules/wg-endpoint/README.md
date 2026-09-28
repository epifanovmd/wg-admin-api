# Модуль wg-endpoint

Точки подключения — стабильные адреса, которые попадают в клиентские конфиги
(`Endpoint = host:port`). Отвязывают адрес подключения от адреса WG-ноды:
ноду можно переносить или менять, не перевыпуская конфиги клиентов.

## Режимы

- **direct** — `host` указывает на саму ноду (стабильный DNS/anycast-IP);
  системой не обслуживается, просто подставляется в конфиги.
- **relay** — `host` обслуживает релей-нода (`relayNodeId`, обычная нода с
  агентом, например VPS бэкенда). Агент релея настраивает проброс UDP до
  целевой ноды интерфейса:
  - `forwardMode=dnat` — iptables DNAT на публичный адрес целевой ноды;
  - `forwardMode=ipip` — IPIP-туннель (обход потерь и фильтрации UDP на
    пути у хостера) + DNAT внутрь туннеля.

## Модель

- **WgEndpoint** (`wg_endpoints`) — name (unique), host, mode, relayNodeId
  (FK RESTRICT), forwardMode.
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

CRUD + options; права `wg:endpoint:view` (чтение), `wg:endpoint:create`,
`wg:endpoint:update`, `wg:endpoint:delete`.
Удаление используемой точки — 409 (FK RESTRICT от интерфейсов).

## События

`WgEndpointUpdatedEvent(dto, previous)` — при изменении host/mode/relay/
forwardMode; модуль wg-interface пересинхронизирует линки и поднимает версии
конфигурации затронутых нод. `WgEndpointChangedEvent(dto)` — при любом
сохранении (в том числе названия и описания), для UI.

Сокет: комната `wg-endpoints` (право `wg:endpoint:view`) —
`wg:endpoint:updated` (создание и любое изменение), `wg:endpoint:deleted`.
