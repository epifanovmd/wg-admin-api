# Модуль Agent

Агенты на узлах и их воркеры. Агент — программа [github.com/epifanovmd/agent](https://github.com/epifanovmd/agent)
(формат сообщений — [docs/PROTOCOL.md](https://github.com/epifanovmd/agent/blob/main/docs/PROTOCOL.md)).
Сторона сервера протокола — **ядро `src/core/agent`**: оно не знает о модулях проекта и
переносится в другой бэкенд на том же каркасе как есть. Модуль `agent` — то, что зависит от
проекта: REST, права и политики доступа, события Socket.IO, наблюдение, аудит.

```
бэкенд ──поток SSE (желаемое, команды)──► агент ──unix-сокет──► воркер
       ◄──HTTPS POST (итоги, события, состояние, метрики, журнал, запросы)──
```

Связь открывает только агент. Воркер — программа на любом языке; агент запускает воркеры из
своих настроек (`agent.yaml`), передаёт им их часть желаемого и команды, а бэкенду — итоги,
события, пульс и метрики, не разбирая их.

## Структура файлов

```
src/core/agent/                   # ядро: протокол без привязки к проекту
├── protocol.ts                   # типы протокола, коды, compareAgentVersions
├── agent.config.ts               # AGENT_* (ниже)
├── agent*.entity.ts / *.repository.ts   # agents, agent_configs, agent_commands, agent_events, agent_metrics, токены
├── agents.service.ts             # Agents — API для модулей: агенты, желаемое, настройки, команды, сборки, история
├── agent-protocol.service.ts     # регистрация, вход по ключу, hello/state/results/events/metrics/logs/requests
├── agent-streams.ts              # потоки SSE и длинный опрос этой копии API
├── agent-link.handler.ts         # RAW_HTTP_HANDLER: /agent/v1/*
├── agent-files.ts                # раздача архивов (/agent/v1/bundle) и сборок воркеров (/agent/v1/releases), команда установки
├── agent-enrollment.service.ts   # токены регистрации
├── agent-schemas.ts              # проверка по JSON Schema из манифестов воркеров
├── agent-job.executor.ts         # EXTERNAL_JOB_EXECUTOR: внешние задачи → команды воркерам (в проекте не используется)
├── agent-prune.job.ts            # cron agents.prune: история, старые и просроченные команды
├── agent.signals.ts              # PgSignals: agent_push, agent_result
├── agent.events.ts / agent.errors.ts
└── agent-core.module.ts / agent-core.bootstrap.ts

src/modules/agent/                # модуль проекта
├── agent.service.ts              # AgentService: доступ, DTO, действия пользователя с аудитом
├── agent-access.service.ts       # право модуля или политики AGENT_ACCESS_POLICY (агенты своих узлов)
├── *.controller.ts               # REST (ниже)
├── agent.listener.ts             # события ядра → комнаты сокета
├── agent-watch.service.ts        # watch в желаемом, пока клиент в комнате агента
├── agent.handler.ts              # сокет: agent:log-level
├── agent-room.policy.ts          # комната agent_<id>
├── agent.socket-events.ts        # контракт сокета
└── agent.permissions.ts / .errors.ts / .types.ts, dto/, events/, validation/
```

## Протокол в ядре

| Маршрут (`/agent/v1/…`) | Что делает ядро                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST enroll`           | токен (`AGENT_BOOTSTRAP_TOKEN` или выпущенный) → `{agentId, secret}`; хранится только `sha256(secret)` |
| `GET stream`            | SSE: `: ok`, желаемое, команды с `seq` больше `after`; ping раз в 15 с                                 |
| `GET poll`              | длинный опрос для прокси, буферизующих SSE                                                             |
| `POST hello`            | версия, узел, воркеры с манифестами; метки агента — его метки плюс метки токена                        |
| `POST state`            | состояние воркеров и итоги применения настроек (`AgentConfigAppliedEvent`)                             |
| `POST results`          | итоги команд: запись один раз, `AgentCommandFinishedEvent`, сигнал `agent_result` ждущим               |
| `POST events`           | события воркеров: по ключу `(agent_id, id)` один раз; `command.progress` — ход команды                 |
| `POST metrics` / `logs` | последняя точка — в агента, история — не чаще `AGENT_METRICS_STORE_INTERVAL_MS`; журнал — в сокет      |
| `POST requests`         | запрос воркера к бэкенду: обработчик `WORKER_REQUEST_HANDLER` модуля-владельца                         |
| `GET bundle/*`          | `install.sh` и новейший архив платформы из `AGENT_BUNDLE_DIR` (без входа)                              |
| `GET releases/*`        | каталог сборок воркеров `AGENT_BUNDLE_DIR/release` (без входа)                                         |

- **Вход** — `Authorization: Agent <id>.<secret>`; неизвестный ключ — `401 AGENT_UNKNOWN`
  (агент регистрируется заново), отозванный — `403 AGENT_REVOKED`. После `agent.rotateKey`
  принимаются оба секрета, пока не придёт первый запрос с новым.
- **Желаемое** — `{rev, workers: {<воркер>: {configs: {<ключ>: {version, data}}}}, watch}`.
  Запись настройки (`Agents.setConfig`) даёт ключу новую версию и поднимает `rev` агента;
  значения в БД шифруются `AGENT_CONFIGS_KEY` (AES-256-GCM), если он задан.
- **Команды** — запись `agent_commands` (`seq` — порядок доставки); незавершённые агент
  получает при каждом подключении, повтор того же `id` агент не выполняет.
- **Связь** — агент на связи, пока открыт его поток (копия API отмечает его раз в 20 с) или
  был запрос за последние 75 с (длинный опрос). Закрытый поток — сразу без связи.
- **Несколько копий API** — поток агента держит одна (`agents.stream_instance`); любая копия
  пишет желаемое и команды в БД и будит её `NOTIFY agent_push`, итоги будят ждущих
  `agent_result`. Липкий балансировщик не нужен.

## Проверка по схемам манифеста

Агент схемы не проверяет — это делает ядро (ajv):

| Что                                          | Не подошло                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| значение настройки — `configs[].schema`      | 400 `AGENT_CONFIG_INVALID`, замечания — `details.reason`                 |
| аргументы команды — `commands[].schema`      | 400 `AGENT_COMMAND_INVALID` (у внешней задачи — её `data`, без повторов) |
| `data` запроса воркера — `requests[].schema` | воркеру `REQUEST_INVALID`, обработчик не вызывается                      |
| `data` события — `events[].schema`           | событие принимается и сохраняется с замечаниями `problems`               |

Необъявленные ключ настроек и команда — 422 `AGENT_CONFIG_UNDECLARED` / `AGENT_COMMAND_UNDECLARED`.

## Таблицы

| Таблица                   | Что                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `agents`                  | ключ (хеш), метки, `hello`, `state`, последняя точка метрик, `desired_rev`, `watch`, поток, связь |
| `agent_configs`           | настройки воркеров: `(agent_id, worker, key)`, версия, значение (`NULL` — удалён), автор          |
| `agent_commands`          | команды: `seq`, `id`, тип, аргументы, воркер, срок, итог, ход, автор                              |
| `agent_events`            | события воркеров, `problems` — замечания проверки по схеме                                        |
| `agent_metrics`           | история точек метрик                                                                              |
| `agent_enrollment_tokens` | токены регистрации: хеш, метки, лимит, срок, отзыв                                                |

Уборка — `agents.prune` раз в час: метрики старше `AGENT_METRICS_RETENTION_HOURS`, события и
выполненные команды старше `AGENT_EVENTS_RETENTION_DAYS`; незавершённые команды с истёкшим
сроком — итог `EXPIRED`.

## REST

Права — `agent:view`, `agent:manage`, `agent:config` (значения настроек), `agent:command`,
`agent:logs`, `agent:enroll`; по умолчанию — только у admin (через `*`). Без права модуля доступ
дают политики `AGENT_ACCESS_POLICY` (модуль `wg-node`: агент ноды — по правам ноды
`wg:node:view`, `wg:node:logs`, `wg:node:agent`, в том числе `:own`); чужой агент — 404.

| Метод  | Путь (`/api/v1/…`)                                                     | Что                                                    |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| GET    | `agents`, `agents/{id}`                                                | агенты: связь, узел, воркеры, метрики, проблемы        |
| GET    | `agents/events`                                                        | лента событий воркеров (курсор)                        |
| GET    | `agents/{id}/metrics`, `agents/{id}/logs`                              | история метрик; журнал с узла (агент на связи)         |
| GET    | `agents/{id}/configs`                                                  | ключи настроек и итоги; значения — с `agent:config`    |
| PUT    | `agents/{id}/workers/{worker}/configs/{key}`                           | записать настройку (тело — значение)                   |
| DELETE | `agents/{id}/workers/{worker}/configs/{key}`                           | удалить настройку                                      |
| POST   | `agents/{id}/workers/{worker}/commands`                                | команда воркеру `{type, args, timeoutMs, waitSeconds}` |
| GET    | `agents/{id}/commands`, `agents/{id}/commands/{cid}`                   | команды и итог (`waitSeconds` — подождать)             |
| POST   | `agents/{id}/commands/{cid}/cancel`                                    | отменить идущую команду воркера                        |
| POST   | `agents/{id}/workers/{worker}/restart` / `update`                      | перезапуск; обновление из каталога сборок (`force`)    |
| POST   | `agents/{id}/update`, `agents/{id}/rotate-key`                         | обновить агента; сменить ключ                          |
| POST   | `agents/{id}/revoke`; DELETE `agents/{id}`                             | отозвать; удалить со всей историей                     |
| POST   | `agent-enrollment/tokens`, GET `…/tokens`, POST `…/tokens/{id}/revoke` | токены регистрации                                     |
| POST   | `agent-enrollment/install-command`                                     | команда установки `curl … \| sudo sh -s -- …`          |
| GET    | `agent-enrollment/release`                                             | сборки воркеров проекта                                |

Действия возвращают поставленную команду (`AgentCommandDto`); итог — по её id и в сокете.

**Удаление.** `DELETE /agents/{id}` и удаление узла удаляют агента: настройки, команды и история
стираются, запись остаётся отозванной (`deleted_at`). Агент на узле получает `403 AGENT_REVOKED`:
останавливает воркеры с `cleanup` и больше не выходит на связь (не регистрируется заново и общим
токеном). Программу с машины убирает `agent uninstall --purge` или удаление по SSH из панели.
На `hello` бэкенд отвечает `status: active`: агент запускает воркеры только после него.
Действия пользователя пишутся в аудит (`agent.action`), итоги его команд — `agent.action-result`.

## Сокет

Комната `agents` (право `agent:view`): `agent:updated`, `agent:deleted`, `agent:event`. Комната
агента (`room:subscribe { type: "agent", id }`): `agent:config`, `agent:command` (поставлена, ход,
итог), `agent:metrics`, `agent:log`; пока в ней есть клиент, агент в наблюдении (`watch`: метрики
раз в секунду, журнал подробнее). `agent:log-level { agentId, level }` — уровень журнала
наблюдения.

## Воркеры проекта и запросы к серверу

Воркеры проекта — `wg` и `socks` (`agent/workers`, [agent/README.md](../../../agent/README.md));
их настройки, итоги, события и метрики разбирает модуль [wg-agent](../wg-agent/README.md).
Запрос воркера к серверу (`POST /requests` воркера) обрабатывает класс `IWorkerRequestHandler`
модуля-владельца (`type`, `workers`, `handle({ agent, worker, data, signal })`), регистрация —
`asWorkerRequestHandler(Класс)` в `providers`; отказ — `throw new WorkerRequestError(code,
message)`. Воркерам проекта запросы пока не нужны.

## События ядра (EventBus)

`AgentEnrolledEvent`, `AgentUpdatedEvent` (`hello`, `state`, `online`, `offline`, `revoked`,
`watch`), `AgentConnectedEvent`, `AgentDeletedEvent`, `AgentConfigChangedEvent`,
`AgentConfigAppliedEvent`, `AgentEventReceivedEvent`, `AgentMetricsReceivedEvent`,
`AgentLogReceivedEvent`, `AgentCommandQueuedEvent`, `AgentCommandProgressEvent`,
`AgentCommandFinishedEvent`. Модули подписываются на них (узлы, аудит, сокет), ядро о
подписчиках не знает.

## Переменные окружения

| Переменная                        | По умолчанию     | Что                                               |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| `AGENT_VERSION`                   | —                | версия агента для `yarn agent*`, образов и e2e    |
| `AGENT_BOOTSTRAP_TOKEN`           | —                | общий токен регистрации (не короче 32 символов)   |
| `AGENT_STATE_INTERVAL_MS`         | 30000            | как часто агент присылает состояние               |
| `AGENT_METRICS_INTERVAL_MS`       | 15000            | как часто агент присылает метрики                 |
| `AGENT_METRICS_STORE_INTERVAL_MS` | 60000            | точку в историю — не чаще (0 — каждую)            |
| `AGENT_METRICS_RETENTION_HOURS`   | 168              | сколько хранить историю метрик                    |
| `AGENT_EVENTS_RETENTION_DAYS`     | 14               | сколько хранить события и выполненные команды     |
| `AGENT_BUNDLE_DIR`                | —                | архивы для узлов и `release/` (`yarn agent:pack`) |
| `AGENT_CONFIGS_KEY`               | —                | ключ шифрования значений настроек                 |
| `AGENT_PUBLIC_URL`                | `APP_PUBLIC_URL` | адрес API для агентов (команда установки)         |
