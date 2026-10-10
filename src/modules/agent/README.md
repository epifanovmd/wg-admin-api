# Модуль Agent

Агенты на узлах и их воркеры. Связь с агентами (регистрация, WebSocket, подтверждения и
повторы), запросы к воркерам, настройки воркеров, наблюдение, встроенные действия, раздачу сборок агента и
установку ведёт `Agents` из `agent-sdk/server` (агент и SDK —
[github.com/epifanovmd/agent](https://github.com/epifanovmd/agent), формат —
[sdk/spec/README.md](https://github.com/epifanovmd/agent/blob/main/sdk/spec/README.md)).
Модуль даёт SDK хранилище на Postgres, регистрацию по токенам из БД, связь между процессами
API, историю событий воркеров, REST, события Socket.IO, аудит и сервисы для модулей
домена (`AgentService`, `AgentWorkerService` — без проверки прав). Что делают воркеры
нод, решает WG-домен (модули wg-node, wg-agent); воркеры — `agent/workers`.

```
бэкенд (Agents) ──WebSocket──► агент ──HTTP по unix-сокету──► воркер (без SDK)
```

Соединение открывает только агент. Воркер — обычный HTTP-сервис на любом языке; агент
запускает воркеры из своих настроек (`agent.yaml`) и ничего не знает об их работе: он
передаёт запросы, настройки, события и метрики, не разбирая их.

## Структура файлов

```
src/modules/agent/
├── agent.module.ts             # @Module: сущности, провайдеры, токены расширения, AgentBootstrap
├── agent.runtime.ts            # AgentRuntime: Agents процесса, onEvent, события SDK → EventBus, сигналы
├── agent.bootstrap.ts          # старт: события, LISTEN; на ролях с HTTP — WebSocket и наблюдение
├── agent.signals.ts            # AgentSignals (PgSignals): канал agents_changed
├── agent-link.handler.ts       # RAW_HTTP_HANDLER: /api/v1/agent-link/* → agents.handle
├── agent-bundle.handler.ts     # RAW_HTTP_HANDLER: /api/v1/agent-bundle/* — install.sh и архивы для нод
├── agent-bundle.ts             # скрипт и команда установки, выбор архива из AGENT_BUNDLE_DIR
├── agent-relay.server.ts       # внутренний HTTP-сервер пересылки (AGENT_RELAY_PORT): POST /internal/agent-relay → handleRelay
├── store/agent.store.ts        # AgentStore implements Store (Postgres): агенты и настройки
├── store/stored-agent*.entity.ts
├── agent-history.service.ts    # события воркеров: запись, лента, уборка
├── agent-worker-event.*        # сущность и репозиторий событий
├── agent-enrollment.service.ts # токены регистрации + хук enroll, контекст регистрации
├── agent-enrollment-token.*    # сущность и репозиторий токенов
├── agent-access.service.ts     # доступ: право модуля или политики AGENT_ACCESS_POLICY
├── agent.service.ts            # агенты: список, карточка, проблемы, отзыв, удаление, ключ, обновление, журнал, сборки агента
├── agent-worker.service.ts     # воркеры: перезапуск, обновление, настройки, запрос к воркеру
├── *.controller.ts             # REST (ниже)
├── agent-watch.service.ts      # watch, пока сокет в комнате agent_<id>
├── agent.handler.ts            # сокет: agent:log-level
├── agent.listener.ts           # EventBus → комнаты agents / agent_<id>
├── agent-room.policy.ts        # комната agent_<id>
├── agent-prune.job.ts          # cron agents.prune
├── agent.socket-events.ts      # контракт сокета
├── agent.config.ts / .errors.ts / .permissions.ts / .types.ts
├── dto/ events/ validation/
└── *.test.ts                   # юнит; store/agent.store.integration.test.ts — с Postgres
```

## Хранилище SDK (`AgentStore`)

`Store` SDK — 8 методов: агенты (`createAgent`, `getAgent`, `listAgents`, `updateAgent`,
`deleteAgent`) и настройки воркеров (`setConfig`, `listConfigs`, `deleteConfig`).

| Таблица         | Что                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `agents`        | `AgentRecord` целиком в `record` (хеш ключа, учёт потока, последние `hello`, `status`, метрики, проблемы), `rev`                   |
| `agent_configs` | строка на ключ «агент, воркер, ключ»: версия, значение (`jsonb`; с `AGENT_CONFIGS_KEY` — `{ $sealed }`, AES-256-GCM), время, автор |

- **Условная запись агента:** `UPDATE … WHERE id = … AND rev = …` одним запросом; не
  совпало — `false`, SDK перечитывает и повторяет. Несколько процессов не затирают
  изменения друг друга.
- **Версия настройки только растёт:** `INSERT … ON CONFLICT DO UPDATE SET version =
GREATEST(version + 1, minVersion)` — одновременные записи получают разные версии; после
  удаления строка остаётся с `data = NULL` (счётчик), значение `null` — это `'null'::jsonb`.
- Строки с `\u0000` очищаются перед записью (Postgres не принимает их в `jsonb`).
- Id агента — 32 шестнадцатеричных символа (выдаёт SDK); в пути — тип `TAgentId`.

## История (вне SDK)

SDK историю не хранит: она приходит событиями. Модуль пишет события воркеров в
`agent_events` (в `onEvent` SDK: подтверждение агенту — после записи; ключ «агент, id
сообщения» отсекает повтор доставки; `problems` — замечания проверки `data` по схеме);
срок — `AGENT_EVENTS_RETENTION_DAYS`, уборка — cron `agents.prune` (раз в час). Метрики
(`AgentMetricsReceivedEvent`, каждая точка) модули домена пишут в свои таблицы
(статистика WG — модуль wg-stats). Итоги действий и «кто что сделал» — в журнал аудита
(`audit_events`): `agent.action` (событие `audit` SDK) и `agent.action-result` (событие
`action`).

Модули домена подписываются на события воркеров до подтверждения агенту —
`AgentService.onWorkerEvent(handler)`: ошибка обработчика — агент пришлёт событие снова.

## Связь и регистрация

- `/api/v1/agent-link/*` (регистрация, сборки агента) — `RAW_HTTP_HANDLER`: до
  разбора тела, CORS и лимита запросов; в Swagger не входят. WebSocket того же пути —
  `agents.attach(HttpServer)` на ролях `api` и `all`.
- `/api/v1/agent-bundle/*` — установка нод (`AgentBundleHandler`, тоже `RAW_HTTP_HANDLER`, без
  входа: в архиве нет секретов): `install.sh` (архив под машину ноды → `agent install --server
<API> "$@"`; `--uninstall [--purge]` — удалить) и `linux-<arch>.tar.gz` — архив папки агента
  (`agent pack`) из `AGENT_BUNDLE_DIR`. Команда установки (`installCommand`,
  `agent-bundle.ts`) — `curl -fsSL '<API>/api/v1/agent-bundle/install.sh' | sudo sh -s --
--token '<токен>' --name '<нода>'`; экземпляр `wg`, воркеры, пакеты и права — в
  `agent/agent.prod.yaml` архива.
- Регистрация: общий токен окружения `AGENT_BOOTSTRAP_TOKEN` или созданный токен
  (`<prefix>.<secret>`, в БД — префикс и хеш; срок, отзыв, лимит использований). Метки
  токена сильнее меток агента. Новый агент — событие `AgentEnrolledEvent` с источником
  (токен, кто создал, метки): по метке `nodeId` модуль wg-node привязывает агента к ноде.
- `onEvent`: обработчики модулей (`onWorkerEvent`) → запись в
  `agent_events` → событие `AgentEventReceivedEvent` → подтверждение агенту. Ошибка — без
  подтверждения: агент пришлёт событие снова с тем же id. Подписки SDK (`subscribeEvents`,
  `waitEvent`) для обработчиков модулей не годятся: они вызываются после подтверждения и
  видят только события своего процесса — важное обрабатывается в `onEvent`.
- Связь: ping SDK раз в 5 с; агент после обрыва остаётся `online` ещё
  `AGENT_OFFLINE_GRACE_MS` (3 с) — остановленный агент виден `online: false` в сокете
  (`agent:updated`) через ~3 с, пропавшая сеть — через 13–18 с. Своих задержек поверх SDK
  модуль не держит.

## Несколько процессов

Store общий; соединение агента живёт в одном процессе (`agent.session.instance` —
`instanceId` процесса: с пересылкой — внутренний адрес его сервера пересылки
`http://host:port` — `INSTANCE_URL`, иначе `AGENT_RELAY_HOST` (для `0.0.0.0` — IPv4
машины или контейнера) и `AGENT_RELAY_PORT`; без пересылки — адрес API `SERVER_HOST` и
`SERVER_PORT`; у роли `worker` — имя без адреса).

- **Изменения в Store** (настройки, отзыв, удаление) — событие SDK `change` → NOTIFY
  `agents_changed` → остальные процессы вызывают `agents.refresh(agentId)`: процесс с
  соединением досылает настройки или закрывает соединение.
- **Пересылка (relay)** — при общем секрете копий `AGENT_RELAY_SECRET`: вызов, которому
  нужно соединение (`fetch`, перезапуск и обновление воркера, обновление агента, смена ключа, журнал, `watch`), SDK из любого
  процесса пересылает в процесс с соединением — `POST <instanceId>/internal/agent-relay`
  с заголовком `x-agents-relay-secret`; тот выполняет вызов (`agents.handleRelay`) и
  отвечает (у `fetch` — потоком). Маршрут обслуживает только внутренний сервер
  пересылки (`AgentRelayServer`) — отдельный порт `AGENT_RELAY_PORT` (8182) на
  внутреннем адресе `AGENT_RELAY_HOST` (по умолчанию `127.0.0.1`, в контейнере —
  `0.0.0.0`); публичный порт API его не знает (404), без секрета — 401, другие пути — 404. Порт пересылки наружу не публикуют. Пользователю `AGENT_ELSEWHERE` не приходит;
  процесс с соединением недоступен — 502 `RELAY_FAILED`. Сервер пересылки поднимается
  только с секретом и на ролях с HTTP (`api`, `all`).
- **Без секрета** пересылки нет: такой вызов в другом процессе — **503
  `AGENT_ELSEWHERE`** с `Retry-After: 2` (одна копия API или «липкий» балансировщик).
- **Наблюдение (`watch`)** — из процесса, где сокет в комнате агента; продлевается каждые
  20 с, поэтому после переподключения агента к другому процессу доходит и туда.
- Роль `worker` соединений не держит: читает записи агентов и пишет настройки через Store
  (сверка настроек нод — cron модуля wg-agent).
- Dev: две копии на одной машине — разные `SERVER_PORT` и `AGENT_RELAY_PORT`, общий
  `AGENT_RELAY_SECRET`. Docker Compose: реплики `api` — один секрет в `.env.production`,
  `AGENT_RELAY_HOST=0.0.0.0`, порт 8182 только в сети compose, адрес — IP контейнера.

## Права (`AgentPermissions`, группа «Агенты»)

| Право          | Что                                                                               |
| -------------- | --------------------------------------------------------------------------------- |
| `agent:view`   | агенты, воркеры, настройки (чтение), события, метрики, проблемы, сборки агента    |
| `agent:manage` | отзыв, удаление, смена ключа, обновление агента, перезапуск и обновление воркеров |
| `agent:config` | запись и удаление настроек воркеров                                               |
| `agent:fetch`  | запросы к воркерам                                                                |
| `agent:logs`   | журнал агента и воркеров с узла                                                   |
| `agent:enroll` | токены регистрации, команда установки                                             |

Маршруты агентов — `@Security("jwt")`: доступ проверяет `AgentAccessService` — право
модуля (все агенты) или политика `AGENT_ACCESS_POLICY` (модуль wg-node: агент своей ноды с
`wg:node:view`, `wg:node:logs`, `wg:node:agent`). Невидимый агент — 404, видимый без права — 403.
Отзыв и удаление — только с `agent:manage`.

## Строгость манифеста

Воркер описывает себя манифестом (`GET /manifest`), и агент пропускает только объявленное
([sdk/docs/workers.md](https://github.com/epifanovmd/agent/blob/main/sdk/docs/workers.md#манифест-что-воркер-умеет)).
Что проверяет агент и что — сервер (`AgentRuntime`):

| Что                                       | Кто проверяет                     | Не подошло                                                    |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| метод и путь запроса к воркеру — `routes` | агент                             | 404 `AGENT_ROUTE_UNDECLARED`, воркер запроса не видит         |
| тип задачи `POST /jobs` — `jobs`          | агент                             | 409 `AGENT_JOB_UNKNOWN`                                       |
| тело запроса — `routes[].request`         | сервер (`validateRequests: true`) | 400 `AGENT_REQUEST_INVALID`, замечания — в `details.reason`   |
| значение настройки — `configs[].schema`   | сервер (`validateConfigs: true`)  | 400 `AGENT_CONFIG_INVALID`                                    |
| тип события — `events`                    | агент                             | воркеру `400 EVENT_UNDECLARED`, до сервера событие не доходит |
| `data` события — `events[].schema`        | сервер (`AGENT_VALIDATE_EVENTS`)  | ниже                                                          |
| тип запроса воркера — `requests`          | агент                             | воркеру `400 REQUEST_UNDECLARED`                              |
| запрос воркера к серверу                  | сервер                            | обработчиков нет — воркеру `422 REQUEST_UNHANDLED`            |

**События не по схеме** — `AGENT_VALIDATE_EVENTS`: `log` (по умолчанию) — запись в журнал,
событие обрабатывается как обычно и сохраняется с замечаниями (`problems` в ленте и в
`agent:event`); `reject` — то же, но обработчикам модулей (`onWorkerEvent`) событие не
передаётся, в истории оно остаётся с замечаниями; `off` — без проверки. `log` выбран, чтобы
событие воркера другой версии не терялось: расхождение видно в журнале и в ленте, а события
задач (`job.*`) SDK по схеме не проверяет.

Каталог возможностей воркера — `manifest` в карточке агента (`workers[].manifest`):
маршруты со схемами тела и ответа, события со схемой `data`, задачи, запросы к серверу,
ключи настроек. Отдельного маршрута нет. Проверку маршрутов узел может выключить для
воркера (`routes: open` в его `agent.yaml`) — сервер этого не видит.

## REST (jwt, под `/api/v1`)

| Метод и путь                                          | operationId                        | Право / доступ               |
| ----------------------------------------------------- | ---------------------------------- | ---------------------------- |
| `GET /agents`                                         | `GetAgents`                        | view (область)               |
| `GET /agents/alerts?agentId`                          | `GetAgentAlerts`                   | view                         |
| `GET /agents/events?agentId&worker&type&cursor&limit` | `GetAgentEvents`                   | view (лента, курсор)         |
| `GET /agents/{id}`                                    | `GetAgent`                         | view                         |
| `POST /agents/{id}/revoke`                            | `RevokeAgent`                      | `agent:manage`               |
| `DELETE /agents/{id}`                                 | `DeleteAgent` (204)                | `agent:manage`               |
| `POST /agents/{id}/rotate-key`                        | `RotateAgentKey` (204)             | manage                       |
| `POST /agents/{id}/update`                            | `UpdateAgent`                      | manage                       |
| `GET /agents/{id}/logs?worker&lines`                  | `GetAgentLogs`                     | logs                         |
| `POST /agents/{id}/workers/{worker}/restart {force}`  | `RestartAgentWorker`               | manage                       |
| `POST /agents/{id}/workers/{worker}/update {force}`   | `UpdateAgentWorker`                | manage                       |
| `POST /agents/{id}/workers/{worker}/fetch`            | `FetchAgentWorker` (поток)         | fetch                        |
| `GET /agents/{id}/configs?worker`                     | `GetAgentConfigs`                  | view; значение — с config    |
| `GET /agents/{id}/workers/{worker}/configs/{key}`     | `GetAgentWorkerConfig`             | view; значение — с config    |
| `PUT /agents/{id}/workers/{worker}/configs/{key}`     | `SetAgentWorkerConfig`             | config                       |
| `DELETE /agents/{id}/workers/{worker}/configs/{key}`  | `DeleteAgentWorkerConfig` (204)    | config                       |
| `GET /agent-releases`                                 | `GetAgentRelease`                  | view (кандидаты — в области) |
| `POST /agent-releases/install-command`                | `CreateAgentInstallCommand`        | `agent:enroll`               |
| `POST /agent-enrollment-tokens`                       | `CreateAgentEnrollmentToken` (201) | `agent:enroll`               |
| `GET /agent-enrollment-tokens`                        | `GetAgentEnrollmentTokens`         | `agent:enroll`               |
| `POST /agent-enrollment-tokens/{id}/revoke`           | `RevokeAgentEnrollmentToken` (204) | `agent:enroll`               |

- **Карточка агента:** связь, узел, версия, воркеры из `hello` и `status` — `state`
  (`running` — зарегистрирован; `invalid` — не ответил как нужно на `GET /health` или
  `GET /manifest`, причина в `message`), `health` (`ok`, `busy`, `message`, `info`),
  `pending` (замена ждёт, пока воркер занят), `manifest` — каталог возможностей (ключи
  настроек, маршруты со схемами `request`/`response`, события со схемой, типы задач `jobs`,
  запросы к серверу `requests`), `configs` (что на диске агента и итог применения);
  последняя точка метрик, проблемы, процесс с соединением.
- **Настройки:** `PUT` проверяет значение по `schema` ключа из манифеста воркера
  (`validateConfigs`; не подходит — 400 `AGENT_CONFIG_INVALID`), даёт новую версию; агент на
  связи получает её сразу, иначе — при подключении. Статус — `pending | applying | applied |
failed | deleting` (`delivered`, `applied`, `error`); агент удалил ключ — событие сокета
  `agent:config` с `state: deleted` (`version: null`).
- **Запрос к воркеру:** тело `{ method?, path, headers?, body?, encoding?: utf8 | base64,
timeoutMs? }` (тело — до 4 МБ, срок — до 10 мин); ответ — статус, заголовки и тело воркера
  потоком и заголовок `X-Agent-Worker-Status` (статус воркера): ответ воркера с ошибкой
  отличается от ошибки API (тело `{ code, message }`, заголовка нет). Клиент ушёл — запрос к
  воркеру отменяется. Только маршруты манифеста: необъявленный — 404
  `AGENT_ROUTE_UNDECLARED`, тело не по `routes[].request` — 400 `AGENT_REQUEST_INVALID`,
  `POST /jobs` с необъявленным типом — 409 `AGENT_JOB_UNKNOWN`; служебные пути воркера —
  403 `PATH_FORBIDDEN`; ошибка до ответа воркера — код агента (`WORKER_UNAVAILABLE` 502,
  `WORKER_INVALID` 502, `TIMEOUT` 504, …).
  В аудит (`agent.action`, `fetch`) — только изменяющие методы `POST`, `PUT`, `PATCH`,
  `DELETE`.
- **Перезапуск и обновление воркера:** ответ — `{ deferred, pending?, actionId?, version?,
previous? }`. Свободный воркер заменяется сразу (`deferred: false`, у обновления —
  версии). Занятый (`health.busy`) — ответ сразу `{ deferred: true, pending, actionId }`,
  замена — после окончания работы, её итог — событие сокета `agent:action` (`id =
actionId`, `deferred: true`); `force: true` — заменить сразу. Обновление — только воркер
  со сборкой с сервера (`release: true`), иначе 409 `AGENT_WORKER_NOT_RELEASED`.
- **Ошибки SDK** → `AGENT_*` (`NOT_FOUND`, `REVOKED`, `OFFLINE` 503, `ELSEWHERE` 503 — только
  без пересылки, `CONFIG_INVALID`, `ROUTE_UNDECLARED` 404, `JOB_UNKNOWN` 409,
  `REQUEST_INVALID` 400, `EVENT_UNDECLARED` 409, `UPDATE_NOT_AVAILABLE`, `TIMEOUT`, …; текст
  SDK — в `details.reason`); коды агента и SDK (`RELAY_FAILED` 502, `JOB_*`, …) — как есть
  со статусом SDK.

## Socket.IO

| Комната      | Кто входит                                           | События                                                                        |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `agents`     | `room:subscribe { type: "agents" }`, `agent:view`    | `agent:updated`, `agent:deleted`, `agent:alert`, `agent:event`                 |
| `agent_<id>` | `{ type: "agent", id }`: доступ к агенту на просмотр | то же по агенту + `agent:metrics`, `agent:log`, `agent:config`, `agent:action` |

`agent:release` `{ version, previous?, from }` — без комнаты, всем подключённым: вышла
новая версия агента (клиент перечитывает `GET /api/v1/agent-releases`).

Пока сокет в комнате агента, сервер держит наблюдателя `watch`: метрики раз в секунду,
журнал с уровня клиента (`agent:log-level { agentId, level }`, по умолчанию `info`).
Выход из комнаты или отключение снимают наблюдателя.

## Конфигурация

`AGENT_BOOTSTRAP_TOKEN`, `AGENT_STATUS_INTERVAL_MS` (15000), `AGENT_METRICS_INTERVAL_MS`
(15000), `AGENT_EVENTS_RETENTION_DAYS` (14), `AGENT_OFFLINE_GRACE_MS` (3000),
`AGENT_RELAY_SECRET` (пересылка между копиями), `AGENT_RELAY_PORT` (8182) и
`AGENT_RELAY_HOST` (`127.0.0.1`) — внутренний сервер пересылки, `INSTANCE_URL` (адрес
сервера пересылки копии), `AGENT_BUNDLE_DIR` (`agent/bundle` — архивы папки агента для нод,
`yarn agent:pack`; в образе — `/app/agent/bundle`), `AGENT_CONFIGS_KEY` (шифрование значений
настроек в БД), `AGENT_PUBLIC_URL` (адрес API в скрипте и команде установки),
`AGENT_VALIDATE_EVENTS` (`log`; `off | log |
reject` — [выше](#строгость-манифеста)); `TRUST_PROXY` — адрес агента за прокси.

**Откуда агент.** Агента и воркер `netprobe` SDK берёт из удалённого источника
(`agentReleases`), воркеры проекта — из `release/` каталога архивов `AGENT_BUNDLE_DIR`
(`agent pack --release-out`: `manifest.json` и сборки, подписанные ключом проекта
`AGENT_SIGNING_KEY`; нет каталога — воркеры с API не обновляются); вместе это итоговый манифест сборок
(`GET /api/v1/agent-releases`, у каждой сборки — `source`: `remote` или `local`):

- `AGENT_RELEASES_GITHUB` (`epifanovmd/agent`; пусто — без GitHub) и `AGENT_RELEASES_RANGE`
  (`^1`) — релизы GitHub, новейшая версия в диапазоне; `AGENT_RELEASES_TOKEN` — токен GitHub
  для лимитов API;
- `AGENT_RELEASES_URL` — адрес сборок одной версии (`<url>/manifest.json`): зеркало или закреплённая
  версия; важнее GitHub;
- `AGENT_RELEASES_CHECK_INTERVAL_MS` (3 600 000) — как часто проверять, первая проверка — при
  старте; `AGENT_RELEASES_PROXY` (`false`) — сборки агента узлам через бэкенд потоком, иначе
  перенаправление на источник;
- `AGENT_RELEASES_PUBLIC_KEY` — ключ автора агента: им подписаны агент и netprobe (по
  умолчанию — ключ релизов `epifanovmd/agent`; пусто — из `manifest.json` источника).

Ключ проекта нода получает из архива при `agent install` (его кладёт `agent pack`), ключ
автора агента вшит в программу агента.

Новая версия в источнике — запись в журнал и сокет `agent:release` `{ version, previous?,
from }` всем клиентам (каждая копия бэкенда проверяет сама: событие может прийти несколько
раз). Ошибка сети или GitHub — предупреждение в журнал, остаётся прежняя версия.

## Тесты

Юнит: доступ, регистрация, ошибки, история, скрипт и команда установки (`agent-bundle.test.ts`). Хранилище на Postgres (и шифрование значений
с `AGENT_CONFIGS_KEY`) —
`TEST_DATABASE_URL=postgres://…/<тестовая база> yarn test:file src/modules/agent/store/agent.store.integration.test.ts`.
E2E — `test/e2e/agents.e2e.ts`: настоящий агент (сборки с GitHub, скачанные заранее —
`yarn agent:fetch`) с воркерами wg (`WG_DRY_RUN`) и socks (хелпер `test/e2e/real-agent.ts`):
регистрация по токену ноды, настройки и их итог, метрики, запрос к воркеру, журнал, действия,
токены, отзыв и удаление. `test/e2e/agent-update.e2e.ts` — сборки: агент из источника
(сервер стенда вместо GitHub, `test/e2e/agent-release.ts`), архив `agent pack` стенда с
воркерами проекта, подписанными ключом стенда, `install.sh` и архив с `/api/v1/agent-bundle`, обновление воркера проекта и обновление прежнего
агента (`yarn agent:fetch 1.0.1`) до версии источника. Сценарии домена — фейковый агент на
WebSocket (`test/e2e/fake-agent.ts`).
