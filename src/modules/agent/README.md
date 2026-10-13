# Модуль Agent

Агенты на узлах и их воркеры. Связь с агентами (регистрация, WebSocket, подтверждения и
повторы), запросы к воркерам, настройки воркеров, наблюдение, встроенные действия и раздачу
сборок воркеров проекта ведёт `Agents` из `agent-sdk/server` (агент и SDK —
[github.com/epifanovmd/agent](https://github.com/epifanovmd/agent), формат —
[sdk/spec/README.md](https://github.com/epifanovmd/agent/blob/main/sdk/spec/README.md)).
Модуль даёт SDK хранилище на Postgres, регистрацию по токенам из БД, связь между процессами
API, историю событий воркеров, проверку по схемам манифеста, проблемы агентов, кандидатов на
обновление, REST, события Socket.IO, аудит и сервисы для модулей домена (`AgentService`,
`AgentWorkerService` — без проверки прав). Что делают воркеры
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
├── agent.runtime.ts            # AgentRuntime: Agents процесса, onEvent, события SDK → EventBus, сигналы, аудит, проблемы
├── agent.bootstrap.ts          # старт: события, LISTEN; на ролях с HTTP — WebSocket и наблюдение
├── agent.signals.ts            # AgentSignals (PgSignals): канал agents_changed
├── agent-link.handler.ts       # RAW_HTTP_HANDLER: /api/v1/agent-link/* → agents.handle
├── store/agent.store.ts        # AgentStore implements Store (Postgres): агенты и настройки
├── store/stored-agent*.entity.ts
├── agent-history.service.ts    # события воркеров: запись, лента, уборка
├── agent-worker-event.*        # сущность и репозиторий событий
├── agent-enrollment.service.ts # токены регистрации + хук enroll, контекст регистрации
├── agent-enrollment-token.*    # сущность и репозиторий токенов
├── agent-access.service.ts     # доступ: право модуля или политики AGENT_ACCESS_POLICY
├── agent.service.ts            # агенты: список, карточка, проблемы, отзыв, удаление, ключ, обновление, журнал, сборки проекта
├── agent-worker.service.ts     # воркеры: перезапуск, обновление, настройки, запрос к воркеру (проверка по манифесту)
├── agent-alerts.ts             # проблемы агента из его записи и статусов настроек (agentAlerts)
├── agent-update-candidates.ts  # кандидаты на обновление: агенты (update.latest) и воркеры (сборки проекта)
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
| `agents`        | `AgentRecord` целиком в `record` (хеш ключа, учёт потока, последние `hello`, `status`, метрики, итоги настроек), `rev`             |
| `agent_configs` | строка на ключ «агент, воркер, ключ»: версия, значение (`jsonb`; с `AGENT_CONFIGS_KEY` — `{ $sealed }`, AES-256-GCM), время, автор |

- **Условная запись агента:** `UPDATE … WHERE id = … AND rev = …` одним запросом; не
  совпало — `false`, SDK перечитывает и повторяет. Несколько процессов не затирают
  изменения друг друга.
- **Версия настройки только растёт:** `INSERT … ON CONFLICT DO UPDATE SET version =
GREATEST(version + 1, minVersion)` — одновременные записи получают разные версии; после
  удаления строка остаётся с `data = NULL` (счётчик), значение `null` — это `'null'::jsonb`.
- Строки с `\u0000` очищаются перед записью (Postgres не принимает их в `jsonb`).
- Автор значения (`actor`, в ответах — `config.actor`) — пользователь, от имени которого модуль
  вызвал `setConfig` (`AgentStore.withActor`); запись системы — без автора.
- Id агента — 32 шестнадцатеричных символа (выдаёт SDK); в пути — тип `TAgentId`.

## История (вне SDK)

SDK историю не хранит: она приходит событиями. Модуль пишет события воркеров в
`agent_events` (в `onEvent` SDK: подтверждение агенту — после записи; ключ «агент, id
сообщения» отсекает повтор доставки; `problems` — замечания проверки `data` по схеме);
срок — `AGENT_EVENTS_RETENTION_DAYS`, уборка — cron `agents.prune` (раз в час). Метрики
(`AgentMetricsReceivedEvent`, каждая точка) модули домена пишут в свои таблицы
(статистика WG — модуль wg-stats). Итоги действий и «кто что сделал» — в журнал аудита
(`audit_events`): `agent.action` (`AgentActionAuditedEvent` — его шлёт модуль сам из
сервисов: регистрация, отзыв, удаление, смена ключа, обновление, журнал, перезапуск и
обновление воркера, запись и удаление настроек, изменяющий запрос к воркеру; пользователь
или система) и `agent.action-result` (событие SDK `action`; автор — из вызова модуля).

Модули домена подписываются на события воркеров до подтверждения агенту —
`AgentService.onWorkerEvent(handler)`: ошибка обработчика — агент пришлёт событие снова.

## Связь и регистрация

- `/api/v1/agent-link/*` (регистрация, сборки воркеров проекта) — `RAW_HTTP_HANDLER`: до
  разбора тела, CORS и лимита запросов; в Swagger не входят. WebSocket того же пути —
  `agents.attach(HttpServer)` на ролях `api` и `all`.
- `/api/v1/agent-link/bundle/*` — установка нод из архива папки агента (`agent-bundle.ts`,
  каталог `AGENT_BUNDLE_DIR`, без входа: в архиве нет секретов): `install.sh` — установщик агента
  из его релиза (архив под машину ноды → `agent install`; `--uninstall [--purge]` — удалить) и
  новейший `<os>-<arch>.tar.gz`. Команда установки — `AgentService.installCommand`: `curl -fsSL
'<API>/api/v1/agent-link/bundle/install.sh' | sudo sh -s -- '--server' '<API>' '--bundle'
'<API>/api/v1/agent-link/bundle/linux-{arch}.tar.gz' '--token' '<токен>' '--name' '<нода>'`;
  экземпляр `wg`, воркеры, пакеты и права — в `agent/agent.prod.yaml` архива.
- Регистрация: общий токен окружения `AGENT_BOOTSTRAP_TOKEN` или созданный токен
  (`<prefix>.<secret>`, в БД — префикс и хеш; срок, отзыв, лимит использований). Метки
  токена сильнее меток агента. Новый агент — событие `AgentEnrolledEvent` с источником
  (токен, кто создал, метки): по метке `nodeId` модуль wg-node привязывает агента к ноде.
- `onEvent`: проверка `data` по схеме события (`AGENT_VALIDATE_EVENTS`) → обработчики модулей
  (`onWorkerEvent`) → запись в
  `agent_events` → событие `AgentEventReceivedEvent` → подтверждение агенту. Ошибка — без
  подтверждения: агент пришлёт событие снова с тем же id.
- Связь: ping SDK раз в 5 с; агент после обрыва остаётся `online` ещё
  `AGENT_OFFLINE_GRACE_MS` (3 с) — остановленный агент виден `online: false` в сокете
  (`agent:updated`) через ~3 с, пропавшая сеть — через 13–18 с. Своих задержек поверх SDK
  модуль не держит.

## Несколько процессов

Store общий; соединение агента живёт в одном процессе (`agent.session.instance` —
`instanceId` процесса: адрес API `SERVER_HOST` и `SERVER_PORT`, для `0.0.0.0` — IPv4 машины
или контейнера; у роли `worker` — имя без адреса).

- **Изменения в Store** (настройки, отзыв, удаление) — событие SDK `change` → NOTIFY
  `agents_changed` → остальные процессы вызывают `agents.refresh(agentId)`: процесс с
  соединением досылает настройки или закрывает соединение.
- **Вызов, которому нужно соединение** (`fetch`, перезапуск и обновление воркера, обновление
  агента, смена ключа, журнал, `watch`), в другом процессе — **503 `AGENT_ELSEWHERE`** с
  `Retry-After: 2`: клиент повторяет, «липкий» балансировщик (по агенту) приводит вызов в
  процесс с соединением. Несколько копий API — только за таким балансировщиком.
- **Наблюдение (`watch`)** — из процесса, где сокет в комнате агента; SDK продлевает его сам
  до `close`. В процессе без соединения агента наблюдения нет (`AGENT_ELSEWHERE`).
- **Проблемы и новая версия агента** — по событиям SDK этого процесса (`agent`, `config`):
  о начавшейся и закончившейся проблеме сообщает процесс, который получил изменение.
- Роль `worker` соединений не держит: читает записи агентов и пишет настройки через Store
  (сверка настроек нод — cron модуля wg-agent).

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
Что проверяет агент и что — сервер (модуль — `schemaProblems` SDK по манифесту из записи
агента; схему нельзя применить — запись в журнал, без проверки):

| Что                                       | Кто проверяет                    | Не подошло                                                    |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| метод и путь запроса к воркеру — `routes` | агент                            | 404 `AGENT_ROUTE_UNDECLARED`, воркер запроса не видит         |
| тип задачи `POST /jobs` — `jobs`          | агент                            | 409 `AGENT_JOB_UNKNOWN`                                       |
| тело запроса — `routes[].request`         | сервер (`AgentWorkerService`)    | 400 `AGENT_REQUEST_INVALID`, замечания — в `details.reason`   |
| значение настройки — `configs[].schema`   | сервер (`AgentWorkerService`)    | 400 `AGENT_CONFIG_INVALID`                                    |
| тип события — `events`                    | агент                            | воркеру `400 EVENT_UNDECLARED`, до сервера событие не доходит |
| `data` события — `events[].schema`        | сервер (`AGENT_VALIDATE_EVENTS`) | ниже                                                          |
| тип запроса воркера — `requests`          | агент                            | воркеру `400 REQUEST_UNDECLARED`                              |
| запрос воркера к серверу                  | SDK                              | обработчика нет — воркеру `422 REQUEST_UNHANDLED`             |

**События не по схеме** — `AGENT_VALIDATE_EVENTS`: `log` (по умолчанию) — запись в журнал,
событие обрабатывается как обычно и сохраняется с замечаниями (`problems` в ленте и в
`agent:event`); `reject` — то же, но обработчикам модулей (`onWorkerEvent`) событие не
передаётся, в истории оно остаётся с замечаниями; `off` — без проверки. `log` выбран, чтобы
событие воркера другой версии не терялось: расхождение видно в журнале и в ленте, а события
задач (`job.*`, `JOB_EVENTS` SDK) по схеме не проверяются.

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
  последняя точка метрик, проблемы (ниже), процесс с соединением.
- **Проблемы** (`alerts` в карточке, `GET /agents/alerts`, сокет `agent:alert`) модуль выводит
  сам (`agentAlerts`) из записи агента и статусов настроек: `offline` — агент без связи
  (`since` — `lastSeenAt`), `workerDown:<воркер>` — `backoff` или `stopped`,
  `workerInvalid:<воркер>`, `workerUnhealthy:<воркер>` — `health.ok: false`,
  `configFailed:<воркер>/<ключ>` — ключ в `failed`. `since` проблемы держит процесс, который
  о ней сообщил; после запуска процесса — время последнего `status` (у настроек — статуса
  ключа).
- **Настройки:** `PUT` проверяет значение по `schema` ключа из манифеста воркера
  (не подходит — 400 `AGENT_CONFIG_INVALID`), даёт новую версию; агент на
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
- **Ошибки SDK** → `AGENT_*` (`NOT_FOUND`, `REVOKED`, `OFFLINE` 503, `ELSEWHERE` 503 с
  `Retry-After`, `CONFIG_INVALID`, `ROUTE_UNDECLARED` 404, `JOB_UNKNOWN` 409,
  `REQUEST_INVALID` 400, `EVENT_UNDECLARED` 409, `UPDATE_NOT_AVAILABLE`, `TIMEOUT`, …; текст
  SDK — в `details.reason`); коды агента и SDK (`JOB_*`, …) — как есть со статусом SDK.

## Socket.IO

| Комната      | Кто входит                                           | События                                                                        |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `agents`     | `room:subscribe { type: "agents" }`, `agent:view`    | `agent:updated`, `agent:deleted`, `agent:alert`, `agent:event`                 |
| `agent_<id>` | `{ type: "agent", id }`: доступ к агенту на просмотр | то же по агенту + `agent:metrics`, `agent:log`, `agent:config`, `agent:action` |

`agent:release` `{ version, previous?, from }` — без комнаты, всем подключённым: агенты нашли
новую версию агента — новейшая `update.latest` среди них выросла (`from` — `agent:<имя>`;
клиент перечитывает `GET /api/v1/agent-releases`).

Пока сокет в комнате агента, сервер держит наблюдателя `watch`: метрики раз в секунду,
журнал с уровня клиента (`agent:log-level { agentId, level }`, по умолчанию `info`).
Выход из комнаты или отключение снимают наблюдателя.

## Конфигурация

`AGENT_BOOTSTRAP_TOKEN`, `AGENT_STATUS_INTERVAL_MS` (15000), `AGENT_METRICS_INTERVAL_MS`
(15000), `AGENT_EVENTS_RETENTION_DAYS` (14), `AGENT_OFFLINE_GRACE_MS` (3000),
`AGENT_BUNDLE_DIR` (`agent/bundle` — архивы папки агента для нод, `yarn agent:pack`; в образе —
`/app/agent/bundle`), `AGENT_CONFIGS_KEY` (шифрование значений настроек в БД),
`AGENT_PUBLIC_URL` (адрес API в скрипте и команде установки), `AGENT_VALIDATE_EVENTS` (`log`;
`off | log | reject` — [выше](#строгость-манифеста)); `TRUST_PROXY` — адрес агента за прокси.

**Сборки.** Бэкенд раздаёт только сборки воркеров проекта — `release/` каталога архивов
`AGENT_BUNDLE_DIR` (`releasesDir` SDK; `agent pack --release-out`: `manifest.json` с версией
агента, которым собраны архивы, и сборки, подписанные ключом проекта `AGENT_SIGNING_KEY`; нет
каталога — воркеры с API не обновляются). `GET /api/v1/agent-releases` — эти сборки (у каждой
`source: local`) и кандидаты на обновление в области просмотра. Ключ проекта нода получает из
архива при `agent install`, ключ автора агента вшит в программу агента.

**Агент** берёт свои сборки сам из своего каталога сборок (`update.releases` в `agent.yaml`;
по умолчанию — релизы GitHub агента): проверяет новую версию раз в `update.checkInterval` и
сообщает её в `hello`/`status` — `update { latest, checkedAt }` в `AgentDto`, до веба доходит
с `agent:updated`. Такой агент, если он обновляет себя сам (`updateMode` — `self` или не
сообщён), — кандидат (`source: agent`, `agent-update-candidates.ts`); обновление агента
(`POST /agents/{id}/update`, обновление агента ноды) передаёт ему эту версию
(`updateAgent(id, { version })`), сборку агент скачивает и проверяет сам. Агент себя не
обновляет — 409 `AGENT_UPDATE_NOT_SUPPORTED`, новой версии нет — 409
`AGENT_UPDATE_NOT_AVAILABLE`. Воркер со сборкой с сервера (`release: true`) — кандидат до
новейшей сборки проекта под платформу агента, если её версия другая.

## Тесты

Юнит: доступ, регистрация, ошибки, история, проблемы, кандидаты на обновление, проверка по
манифесту и аудит (`AgentWorkerService`, `AgentRuntime`). Хранилище на Postgres (и шифрование значений
с `AGENT_CONFIGS_KEY`) —
`TEST_DATABASE_URL=postgres://…/<тестовая база> yarn test:file src/modules/agent/store/agent.store.integration.test.ts`.
E2E — `test/e2e/agents.e2e.ts`: настоящий агент (сборки с GitHub, скачанные заранее —
`yarn agent:fetch`) с воркерами wg (`WG_DRY_RUN`) и socks (хелпер `test/e2e/real-agent.ts`):
регистрация по токену ноды, настройки и их итог, метрики, запрос к воркеру, журнал, действия,
токены, отзыв и удаление. `test/e2e/agent-update.e2e.ts` — сборки: архив `agent pack`
стенда с воркерами проекта, подписанными ключом стенда, `install.sh` и архив с
`/api/v1/agent-link/bundle`, обновление воркера проекта; прежний агент
(`yarn agent:fetch 1.4.0`) находит новую версию в своём каталоге сборок (сервер стенда вместо
GitHub, `test/e2e/agent-release.ts`) и обновляется до неё. Сценарии домена — фейковый агент на
WebSocket (`test/e2e/fake-agent.ts`).
