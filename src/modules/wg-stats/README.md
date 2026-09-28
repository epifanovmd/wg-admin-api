# Модуль wg-stats

Статистика WG-домена: приём отчётов агентов, live-снимки и события, история
с агрегатами, сводка дашборда, системные метрики нод. Засев прав роли `user`
(`WgSeedBootstrap`: `wg:peer:own`, `wg:stats:own`).

## Поток данных

Агент шлёт `wg show all dump` + метрики хоста (раз в 1 с, пока админку
смотрят, иначе раз в 10 с) → `WgStatsIngestService.ingest`:

- **Тик**: момент — `now − (sentAt − collectedAt)` по часам агента; повтор
  (`seq` не больше последнего того же `bootId`, ключ `tick:<nodeId>`) —
  `duplicate`; старше 10 с — `backfill` (только история и счётчики, без
  событий и рядов), старше часа — отбрасывается.
- **Пакетно**: live-хранилище читается одним MGET и пишется конвейером,
  история — одной вставкой, пиры — одним `UPDATE … FROM VALUES`; карта пиров
  ноды кэшируется по `configVersion`; сводка overview пересобирается не чаще
  раза в секунду на процесс.
- **Счётчики** монотонны: сброс wg компенсируется базой (`wg-stats-math.ts`,
  восстановление базы из `wg_peers.rx/tx_bytes_total` после рестарта).
- **Live-снимки** пира/интерфейса/ноды/overview — в `WgLiveStore`
  (Redis при `REDIS_URL`, иначе память процесса), TTL 5 мин.
- **Live-события** (EventBus → `WgStatsListener` → комнаты): при зрителях —
  каждый тик, без них — deadband 256 Б/с и максимум раз в 30 с тишины.
  Пиры — одним `WgPeersLiveStatsEvent` за тик и одним событием
  `wg:peers:stats {peers}` на комнату: overview — все пиры тика, комната
  интерфейса — его пиры, «мои пиры» (`wg-peers-own_<userId>`) — пиры
  держателя, комната пира — только он. Участники overview исключены из
  остальных рассылок, держатель со списком своих — из комнаты пира
  (`toRoomExcept`); в личную комнату пользователя статистика не шлётся.
  Остальные — `wg:interface:stats`, `wg:node:stats`, `wg:stats:overview`.
- **Зрители**: `WgViewerDemandService` — есть ли подключённые сокеты в любом
  процессе (ключ `viewers` в live-хранилище, TTL 10 с, кэш 2 с); от него
  зависят частота статистики агентов и частота событий.
- **Ряды скорости** `win:{node|iface|peer}:<id>` — 600 последних точек
  (`IWgSpeedPoint`), TTL 15 мин.
- **История**: `wg_stat_samples` — раз в 60 с на пира (или смена online),
  с дельтами и пиками; `wg_stat_hours` — rollup (cron `wg.stats-rollup`);
  `wg_node_metrics` — раз в 60 с. Ссылки денормализованы без FK — история
  переживает удаление сущностей; чистка — `wg.stats-retention`.
- Пир обновляется батчем (handshake, endpoint, суммарный трафик).

## Эндпоинты (`/api/v1/wg/stats`, тег WgStats)

- `GET overview` — глобальная сводка (`wg:stats:view`) или по своим пирам
  (`wg:stats:own`).
- `GET series` — серии трафика/скорости: фильтры node/interface/peer/user,
  `groupBy=total|node|interface|peer`, шаг авто (мин. 60 с; > 48 ч — часы,
  ≤ 1000 точек). Скорость точки = трафик/шаг, плюс пиковые значения.
- `GET current` — live-снимок для первой отрисовки.
- `GET window/{peer|interface|node}/{id}` — ряд скорости последних минут
  (пир — `wg:stats:view` или держатель с `wg:stats:own`).
- `GET node-metrics` — CPU/память/диск/аптайм ноды (`wg:node:view`).

## Комната overview

`wg-overview` (policy `wg-overview`, право `wg:stats:view`) — только статистика:
`wg:stats:overview`, `wg:node:stats`, `wg:peers:stats`, после проб связности нод —
`wg:stats:mesh` (матрица целиком). Изменения нод, интерфейсов и пиров дашборд берёт
из комнат списков `wg-nodes`, `wg-interfaces`, `wg-peers` (модули wg-node,
wg-interface, wg-peer).

## Здоровье туннелей

Агенты обеих сторон IPIP-линка раз в ~10 с пингуют дальний конец туннеля
(`ping -I wgtN`, 3 пакета) и шлют RTT/потери в `POST /wg-agent/stats`
(`tunnels`). `WgLinkHealthService` сопоставляет туннель с линком по индексу
и хранит последнюю пробу стороны в live-хранилище (TTL 60 с).
`GET /api/v1/wg/stats/links/node/{nodeId}` (право `wg:stats:view`) — линки
ноды в обеих ролях: встречная нода, RTT, потери, статус `ok` / `degraded`
(потери > 0) / `down` (100%) / `unknown` (нет свежей пробы).
После проб агента — `wg:node:links { nodeId, links }` в комнату каждой ноды
линка (с её точки зрения).

## Связность нод

В желаемом состоянии агент получает `probeTargets` — остальные ноды с
`publicHost` (до 50). Список не версионируется: агент берёт его из любого
присланного состояния, изменения нод не заставляют переприменять конфигурацию.
Раз в ~60 с агент пингует цели и шлёт `nodeProbes` со статистикой;
`WgMeshService` хранит измерения «откуда → куда» (TTL 180 с).
`GET /api/v1/wg/stats/mesh` (право `wg:stats:view`) — ноды и ячейки матрицы.
