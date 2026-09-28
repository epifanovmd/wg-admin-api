# Модуль wg-agent

Связь с агентами нод: постоянный канал (WebSocket) и HTTP-протокол
(`/api/v1/wg-agent`, тег WgAgent) как запасной путь. Аутентификация —
api-ключ со scope `wg-agent:<nodeId>` (выпускается модулем wg-node); контакт
обновляет `lastSeenAt` ноды и возвращает её в online. Общая логика обоих
путей (аутентификация, отчёт, приём статистики с пробами, маршрутами и
прокси) — `WgAgentSessionService`.

## Канал постоянной связи

`WgAgentLinkGateway` (IBootstrap, некритичный, только при HTTP — роль
`api|all`) принимает upgrade на `/api/v1/wg-agent/link` (остальные upgrade
достаются Socket.IO), ключ проверяется до установки соединения (401/403 —
отказ). Соединение — `WgAgentLinkConnection`; протокол v1 —
`wg-agent-link.protocol.ts`, JSON-сообщения с полем `type`:

- агент → сервер: `hello {knownVersion}`, `report`, `stats` (с `seq`,
  `bootId`, `collectedAt`, `sentAt`), `command.ack|output|complete`;
- сервер → агент: `welcome {protocol, statsIntervalMs, serverTime}`,
  `state`, `rate {statsIntervalMs}`, `ack {seq}`, `error {message}`;
- закрытие: 1012 — рестарт сервера, 4000 — нет `hello` за 10 с, 4401 — ключ
  отозван или заменён.

Сообщения соединения обрабатываются по очереди. Состояние уходит после
`hello`, если версия агента устарела или есть команды, и по сигналу
`wg_node_changed` (`WgNodeSignals`, debounce 50 мс) — только при новой версии
или новых командах. Частота статистики — по спросу зрителей
(`WgViewerDemandService` модуля wg-stats): `WG_AGENT_LINK_LIVE_STATS_MS`
(1000) или `WG_AGENT_LINK_IDLE_STATS_MS` (10000), пересмотр раз в 2 с.
Ping — `WG_AGENT_LINK_HEARTBEAT_MS`; ключи открытых соединений
перепроверяются раз в `WG_AGENT_LINK_KEY_CHECK_MS`. Разрыв без другого
соединения ноды в процессе — задача `wg.agent-link-lost` с отсрочкой
`WG_AGENT_LINK_OFFLINE_GRACE_SEC`: нода, не выходившая на связь с момента
разрыва, — offline. Живая статистика ноды несёт `transport: link|http`.

## HTTP-протокол (запасной путь)

- `GET state?knownVersion&waitMs` — long-poll желаемого состояния: полный
  снимок (интерфейсы с расшифрованными ключами и пирами, IPIP-туннели обоих
  ролей, пробросы UDP для релея, невыполненные команды, настройки). Ответ
  приходит раньше таймаута при росте `configVersion` или появлении команд:
  триггеры БД (миграция `WgNodeChangedNotify`) шлют NOTIFY `wg_node_changed`
  с id ноды после коммита, `WgNodeSignals` (LISTEN, `PgSignals` ядра) будит
  ожидание сразу. Без LISTEN — опрос раз в секунду, с LISTEN — страховочная
  перепроверка раз в 10 с.
- `POST state` — отчёт: `appliedVersion`/`applyError`, версии агента и wg,
  сведения об ОС, фактические статусы интерфейсов.
- `POST stats` — статистика `wg show all dump` + метрики хоста (частота —
  `settings.statsIntervalMs` состояния), уходит в модуль wg-stats.
- `POST commands/{id}/ack|output|complete` — жизненный цикл императивных
  команд (перезапуск интерфейса, журнал агента, обновление).

- `GET binary/{arch}` (amd64, arm64) — бинарь агента своим ключом, sha256 в
  заголовке `X-Agent-Sha256`; `GET install.sh` — публичный установщик
  (`renderInstallScript` модуля wg-provision, адрес — `APP_PUBLIC_URL`), секретов
  не содержит.

Контракт типов — `wg-agent-protocol.ts`; зеркало в
`agent/internal/protocol/protocol.go` (менять синхронно).

`WgAgentStateService` собирает состояние из wg-interface/wg-peer/wg-endpoint:
туннели строятся из релей-линков (`wgt<index>`, /30 из `WG_RELAY_TUNNEL_CIDR`,
MTU 1480), пробросы — из интерфейсов, обслуживаемых relay-точками ноды, и
включённых пробросов модуля wg-forward. Для интерфейса — список кандидатов
по копиям (основная, затем поднятые реплики по приоритету; закреплённая —
единственная): `dnat` и `route=direct` — прямой адрес копии, `route=tunnel` —
только туннель, `route=auto` — туннель копии, затем её прямой адрес, затем
следующая копия. Агент берёт первого живого кандидата.

## Обновление агента

`WgAgentBinaryService` читает `wg-admin-agent-linux-<arch>` и `VERSION` из
каталога `WG_AGENT_DIST_DIR` (по умолчанию `agent/dist`; бинари собираются в
образе бэкенда) и считает sha256. `GET /api/v1/wg/agent/release` (право `wg:node:view`) —
версия и хэши по архитектурам; нода, чей `agentCodeHash` отличается от хэша
её архитектуры, — кандидат на обновление. `POST
/api/v1/wg/agent/nodes/{nodeId}/update` (право `wg:node:agent`) — команда
`agent-update` с `hash` бинаря архитектуры ноды (`osInfo.arch`); архитектура
неизвестна или бинаря нет — 404 `WG_AGENT_BINARY_NOT_BUILT`.
