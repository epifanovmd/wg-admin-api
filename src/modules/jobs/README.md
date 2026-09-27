# Модуль Jobs

Очередь задач на pg-boss 12 (Postgres): реализация `JobQueue` из ядра
(`src/core/jobs`). Задачи переживают рестарт, повторяются по политике очереди,
выполняются на процессах `APP_ROLE=worker|all`; cron-задачи выполняет ровно
один процесс кластера. Поверх pg-boss — видимые задачи (`job_runs`: статус,
прогресс, лог, отмена между процессами, события по сокету) и запрос-ответ
(`request`). Все обработчики — Node-код в процессе приложения.

## Структура файлов

```
src/modules/jobs/
├── jobs.module.ts            # @Module: провайдеры, JobQueue → PgBossJobQueue, бутстрапер
├── pg-boss.service.ts        # Экземпляр pg-boss: свой пул и схема, ready(), findJob, failFinal
├── pg-boss-job.queue.ts      # JobQueue: enqueue (outbox через manager), request, cancel
├── jobs.bootstrap.ts         # Запуск: start → createQueue → (worker) work + schedule; graceful stop
├── job-handler.registry.ts   # Обработчики из JOB_HANDLER по очереди, умолчания definition
├── job.runner.ts             # Выполнение Node-задачи: контекст, requestId, повторы, метрики
├── job-progress.writer.ts    # Троттлинг ctx.progress/ctx.log (≤ 2 записи/с)
├── job-signals.ts            # LISTEN/NOTIFY: job_cancel, job_settled — одно соединение
├── job-cancel.watcher.ts     # Отмена между процессами: сигнал job_cancel / опрос раз в 2 с
├── job-result.waiter.ts      # Ожидание итога задачи (request): сигнал job_settled + опрос
├── job-lease.reaper.ts       # Возврат задач с истёкшей арендой
├── lease-reaper.handler.ts   # cron-очередь jobs.lease-reaper (раз в минуту)
├── job-retention.handler.ts  # cron-очередь jobs.retention: удаление старых записей
├── job-run.entity.ts         # JobRun (таблица job_runs)
├── job-run.repository.ts     # Выборки и точечные UPDATE записей
├── job-run.tracker.ts        # Переходы статусов, прогресс, JobUpdatedEvent
├── jobs.service.ts           # Список, карточка, отмена — с проверкой доступа
├── jobs.controller.ts        # REST /api/v1/jobs (jwt)
├── jobs.listener.ts          # JobUpdatedEvent → сокет job:updated
├── job-room.policy.ts        # Комната job_<id> по room:subscribe
├── jobs.health.ts            # JobsHealthIndicator (asHealthIndicator, pg-boss запущен)
├── jobs.errors.ts            # JobsError (JOB_*)
├── jobs.types.ts             # EJobRunStatus, константы
├── jobs.socket-events.ts     # job:updated в контракте сокета
├── dto/, validation/, events/
└── *.test.ts                 # Юнит-тесты; jobs.integration.test.ts — с настоящим Postgres
```

## Как пользоваться

```ts
// Обработчик Node-очереди
@Injectable()
export class ExportJob implements IJobHandler<
  { projectId: string },
  { key: string }
> {
  readonly definition = {
    queue: "project.export",
    tracked: true,
    retryLimit: 2,
  };

  async handle(ctx: JobContext<{ projectId: string }>) {
    for (const [i, chunk] of chunks.entries()) {
      if (ctx.signal.aborted)
        throw new JobError("CANCELLED", "Отменена", false);
      await ctx.progress(i / chunks.length, `часть ${i + 1}`);
    }
    return { key };
  }
}
// @Module({ providers: [asJobHandler(ExportJob)] })

// Постановка — в транзакции с данными (outbox)
await dataSource.transaction(async manager => {
  await manager.save(order);
  await jobQueue.enqueue(
    "project.export",
    { projectId },
    {
      manager,
      title: "Экспорт",
      ownerId: userId,
      scope: { type: "project", id: projectId },
    },
  );
});
```

## Очереди и `definition`

| Поле                | Умолчание          | Смысл                                                      |
| ------------------- | ------------------ | ---------------------------------------------------------- |
| `retryLimit`        | 3                  | повторов после ошибки                                      |
| `retryDelaySeconds` | 10                 | задержка первого повтора                                   |
| `retryBackoff`      | true               | экспоненциальная задержка                                  |
| `expireInSeconds`   | 900                | сколько задача может быть активной (не больше суток)       |
| `concurrency`       | `JOBS_CONCURRENCY` | параллельных задач очереди на процесс                      |
| `cron`              | —                  | расписание (UTC); выполняет один процесс кластера          |
| `tracked`           | false              | видимая задача: запись `job_runs`, прогресс, отмена, сокет |

Политика (`retry*`, `expireInSeconds`) применяется к очереди при каждом старте
(`createQueue`/`updateQueue`). Расписания синхронизируются с кодом: `cron`,
удалённый из `definition`, снимается. Реестр при регистрации отклоняет
повторную очередь и `expireInSeconds` больше суток (предел pg-boss).

**Ошибки.** `JobError(code, message, retryable)`: `retryable: false` — исход
`deadletter` в pg-boss (`perJobResults`), задача падает без повторов. Любое другое
исключение — повтор по политике; на последней попытке запись `failed`.

**Корреляция.** Каждая задача выполняется в `requestContext` с
`requestId = job:<queue>:<id>` — он попадает во все логи задачи.

**Метрики.** Если привязан токен `JOB_METRICS` (`IJobMetrics { onStart(queue),
onComplete(queue, ms, ok) }`), раннер вызывает его на каждой задаче. Сам модуль
prom-client не использует.

## Entity: JobRun (таблица `job_runs`)

| Поле                       | Тип                      | Описание                                                    |
| -------------------------- | ------------------------ | ----------------------------------------------------------- |
| `id`                       | `uuid` (PK)              | = id задачи pg-boss                                         |
| `queue`                    | `varchar(100)`           | Очередь                                                     |
| `status`                   | `varchar(16)`            | `queued` / `running` / `completed` / `failed` / `cancelled` |
| `title`                    | `varchar(200)`           | Заголовок для списка                                        |
| `progress`                 | `real`, 0..1             | Прогресс                                                    |
| `progressText`             | `varchar(200)`, nullable | Что делается сейчас                                         |
| `logTail`                  | `jsonb`                  | Последние 200 строк лога                                    |
| `result`                   | `jsonb`, nullable        | Результат                                                   |
| `error`                    | `jsonb`, nullable        | `{ code, message }` последней ошибки                        |
| `ownerId`                  | `uuid`, nullable         | Владелец (без FK: инфраструктурная таблица)                 |
| `scopeType` / `scopeId`    | `varchar`, nullable      | Область видимости (тип + id, например `project`)            |
| `attempt`                  | `int`                    | Номер попытки, с 0                                          |
| `cancelRequested`          | `boolean`                | Запрошена отмена                                            |
| `leaseUntil`               | `timestamptz`, nullable  | Аренда выполняющейся задачи                                 |
| `startedAt` / `finishedAt` | `timestamptz`, nullable  |                                                             |
| `createdAt` / `updatedAt`  | `timestamptz`            |                                                             |

Индексы: `IDX_JOB_RUNS_OWNER_CREATED`, `IDX_JOB_RUNS_SCOPE_CREATED`,
`IDX_JOB_RUNS_STATUS_LEASE`.

Запись создаётся при `enqueue` для `tracked` очередей и при опции
`track: true`, в той же транзакции, что и задача pg-boss (переданной `manager`
или своей). Задачи из cron для видимой очереди получают запись при старте.
Прогресс и лог пишутся точечным `UPDATE` не чаще 2 раз в секунду.

## Отмена и аренда

- `JobQueue.cancel(id)` / `POST /jobs/{id}/cancel`: флаг `cancelRequested`,
  `boss.cancel`, затем `NOTIFY job_cancel '<id>'`. Ждущая задача сразу
  `cancelled`; выполняющаяся получает `ctx.signal.abort()` и после выхода
  обработчика становится `cancelled`.
- `JobSignals` (наследник `PgSignals` ядра) слушает каналы `job_cancel`, `job_settled` одним
  соединением на процесс (на всех ролях). Если LISTEN недоступен (PgBouncer в
  transaction mode, обрыв), подписчики переходят на опрос, а соединение
  переподключается раз в 30 с: воркер опрашивает флаги своих задач раз в 2 с.

## Запрос-ответ (`JobQueue.request`)

`await jobQueue.request<TData, TResult>(queue, data, { timeoutMs, priority, title })`
— поставить видимую задачу и дождаться итога. Переход записи в итоговый статус
шлёт `NOTIFY job_settled '<id>'` в транзакции завершения; `JobResultWaiter`
перечитывает запись по сигналу (и опросом: раз в 5 с с LISTEN, раз в 1 с без).
Итог: `completed` → `result`; `failed`/`cancelled` → 502 `JOB_REQUEST_FAILED`
(`details`: `code`, `reason` обработчика); таймаут (по умолчанию 30 с) → задача
отменяется, 504 `JOB_REQUEST_TIMEOUT`. Без `manager`: ждать коммита чужой
транзакции нельзя.

- Аренда: выполняющаяся задача продлевает `leaseUntil` (60 с) каждые 20 с.
  cron `jobs.lease-reaper` (и старт воркера) находит `running` с истёкшей арендой,
  проваливает активную задачу в pg-boss и приводит запись к её состоянию:
  есть повторы — `queued`, нет — `failed` (`LEASE_EXPIRED`).
- Остановка процесса: pg-boss ждёт активные задачи до `JOBS_SHUTDOWN_TIMEOUT_MS`,
  затем проваливает их (повтор) и прерывает `ctx.signal`.

## REST (jwt)

| Метод | Путь                       | Описание                                                                                                      |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET   | `/api/v1/jobs`             | Свои задачи или задачи scope (`scopeType`+`scopeId`), `status`, `offset`/`limit` → `IPaginatedDto<JobRunDto>` |
| GET   | `/api/v1/jobs/{id}`        | Задача                                                                                                        |
| POST  | `/api/v1/jobs/{id}/cancel` | Отмена (204); завершённая — 409 `JOB_NOT_CANCELLABLE`                                                         |

Доступ: владелец, суперпользователь или `IJobAccessPolicy` scope — токен
`JOB_ACCESS_POLICY` (`asJobAccessPolicy(Cls)`): модуль-владелец scope решает,
кто видит (`view`) и отменяет (`cancel`) задачи. Пример: пространство разрешает
участникам.

## События

| EventBus          | Сокет         | Куда                                                                             |
| ----------------- | ------------- | -------------------------------------------------------------------------------- |
| `JobUpdatedEvent` | `job:updated` | комната `job_<id>`; комната scope `<scopeType>_<scopeId>`, без scope — владельцу |

Комната `job` (`room:subscribe { type: "job", id }`) — владельцу или по
`IJobAccessPolicy`.

## Очереди модуля

| Очередь             | Тип               | Что делает                                              |
| ------------------- | ----------------- | ------------------------------------------------------- |
| `jobs.lease-reaper` | cron `* * * * *`  | возвращает задачи с истёкшей арендой                    |
| `jobs.retention`    | cron `30 3 * * *` | удаляет завершённые записи старше `JOBS_RETENTION_DAYS` |

## Конфиг

`JOBS_CONCURRENCY` (4), `JOBS_SHUTDOWN_TIMEOUT_MS` (20000), `JOBS_POOL_MAX` (4),
`JOBS_RETENTION_DAYS` (30),
`APP_ROLE` (`api`/`worker`/`all`); БД — `POSTGRES_*`. pg-boss держит свою схему
`pgboss` (миграции — сам, `migrate: true`) и свой пул; на ролях `worker`/`all` —
ещё одно соединение под LISTEN pg-boss; на всех ролях — одно под сигналы задач
(`JobSignals`).

## Тесты

Юнит: раннер, очередь, реестр, сервис, сигналы, reaper, watcher, retention,
троттлинг прогресса, listener. Интеграция с Postgres —
`TEST_DATABASE_URL=postgres://… yarn test:file src/modules/jobs/jobs.integration.test.ts`
(без переменной — пропускается; БД одноразовая: схема `pgboss` и `job_runs`
пересоздаются).
