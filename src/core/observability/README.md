# Наблюдаемость (`core/observability`)

Метрики Prometheus, отправка ошибок в Sentry и проверки
здоровья зависимостей. Всё выключается конфигом и без настройки ничего не
отправляет наружу.

## Файлы

| Файл                      | Назначение                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `instrument.ts`           | Побочный импорт первой строкой `main.ts`: подключает Sentry до загрузки остальных модулей     |
| `sentry.ts`               | `initSentry` — Sentry только для ошибок; подключает трекер в `error-reporter`                 |
| `error-reporter.ts`       | `reportError(err, ctx)`, `reportProcessError`, `flushErrors`, `setErrorReporter`              |
| `metrics.ts`              | Реестр `metricsRegistry` и все метрики; `trackSocketConnection(socket)`                       |
| `metrics.middleware.ts`   | `metricsMiddleware` — HTTP-гистограмма и счётчик ошибок                                       |
| `job-metrics.ts`          | `PrometheusJobMetrics` — реализация хука `JOB_METRICS` из `core/jobs`                         |
| `health.ts`               | `IHealthIndicator`, `HEALTH_INDICATOR`, `asHealthIndicator`, `probeRedis`, `checkWithTimeout` |
| `observability.module.ts` | `ObservabilityModule` — биндинг `JOB_METRICS → PrometheusJobMetrics`                          |

Эндпоинты `/metrics`, `/health`, `/ready`, `/ping` — в `src/routing/system-routes.ts`
(регистрируются до бизнес-middleware: без rate limit, CORS и авторизации).

## Конфиг

| Переменная        | Секция конфига                 | По умолчанию  | Смысл                                                             |
| ----------------- | ------------------------------ | ------------- | ----------------------------------------------------------------- |
| `METRICS_ENABLED` | `observability.metricsEnabled` | `true`        | `/metrics` и сбор HTTP-метрик                                     |
| `METRICS_TOKEN`   | `observability.metricsToken`   | пусто         | Bearer-токен для `/metrics`; пусто — без защиты (закрывать сетью) |
| `SENTRY_DSN`      | `observability.sentryDsn`      | пусто         | DSN Sentry; пусто — ошибки не отправляются                        |
| `APP_NAME`        | `app.name`                     | `wg-admin`    | Метка `service` метрик, `serverName` в Sentry                     |
| `APP_ROLE`        | `app.role`                     | `all`         | Метка `role` метрик                                               |
| `APP_VERSION`     | — (env)                        | версия пакета | `release` в Sentry; в образ пишется при релизе                    |

## Метрики

Все метрики — в собственном реестре `metricsRegistry` с метками по умолчанию
`service` и `role`. Отдаются `GET /metrics` в текстовом формате Prometheus.

| Метрика                         | Тип       | Метки                       | Источник                                                           |
| ------------------------------- | --------- | --------------------------- | ------------------------------------------------------------------ |
| `process_*`, `nodejs_*`         | разные    | —                           | `collectDefaultMetrics` (CPU, память, GC, event loop lag, handles) |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | `metricsMiddleware`                                                |
| `http_errors_total`             | counter   | `code`, `status`            | `metricsMiddleware` (ответы ≥ 400)                                 |
| `socket_connections`            | gauge     | —                           | `trackSocketConnection(socket)`                                    |
| `jobs_active`                   | gauge     | `queue`                     | `JOB_METRICS.onStart / onComplete`                                 |
| `jobs_total`                    | counter   | `queue`, `outcome`          | `completed` / `failed`                                             |
| `job_duration_seconds`          | histogram | `queue`, `outcome`          | время `handle()`                                                   |

Правила меток (кардинальность):

- `route` — шаблон маршрута `@koa/router` (`ctx._matchedRoute`, например
  `/api/v1/contact/:id`), никогда не URL с идентификаторами. Запрос без маршрута
  (404, сканеры) — `route="unmatched"`.
- `code` — машинный код из тела ошибки (`USER_NOT_FOUND`, `VALIDATION_ERROR`);
  без кода — код по статусу (`NOT_FOUND`, `INTERNAL_ERROR`).
- Пробы `/ping`, `/ready`, `/health` и сам `/metrics` в HTTP-метрики не попадают.

Процесс `worker` тоже поднимает HTTP для проб, поэтому метрики задач
собираются с `/metrics` воркера.

### Подключение

- **HTTP** — `metricsMiddleware` первым middleware Koa (до `RegisterBaseMiddlewares`),
  чтобы видеть итоговый статус и тело ошибки после error middleware.
- **Задачи** — модуль очереди получает `@inject(JOB_METRICS) @optional()` и вызывает
  `onStart(queue)` перед обработчиком и `onComplete(queue, durationMs, ok)` в `finally`.
  Реализацию привязывает `ObservabilityModule` (подключается в `AppModule` после `CoreModule`).
- **Сокеты** — `trackSocketConnection(socket)` в обработчике `connection`: +1 сразу,
  −1 на `disconnect`.

### Пример scrape-конфига

```yaml
scrape_configs:
  - job_name: wg-admin
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs:
      - targets: ["api:8181", "worker:8181"]
```

**Почему первая строка `main.ts`, а не `node --import`.** Сборка — CommonJS
(`tsc` → `build/`), `import` компилируется в `require` в исходном порядке, и под
`tsx` порядок тот же. Поэтому `import "./core/observability/instrument"` первой
строкой гарантирует, что Sentry подключится раньше остальных модулей —
одинаково в `yarn dev`, `yarn server`, e2e и Docker, без флагов запуска.
`instrument.ts` импортирует только `config` и файлы этого каталога (не
`core/index`), иначе модули приложения загрузились бы раньше Sentry.

## Ошибки (Sentry)

- `@sentry/node` инициализируется в `instrument.ts` при `SENTRY_DSN` (лениво, без
  DSN пакет не грузится). Только ошибки, без трассировки.
- `reportError(err, ctx, status = ctx.status)` — хук error middleware: в трекер
  уходят только 5xx, с тегами `source=http`, `route`, `request_id` и `user.id`.
- `reportProcessError(err, "unhandledRejection" | "uncaughtException")` — из
  обработчиков процесса в `main.ts`; встроенные интеграции Sentry для этих событий
  отключены, чтобы не было дублей и чужой логики выхода.
- `flushErrors()` — перед `process.exit` (в `main.ts`).
- Тесты подменяют трекер `setErrorReporter(fake)`.

## Здоровье

| Маршрут   | Что проверяет                                                                                                                        | Коды      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `/ping`   | Процесс жив (liveness)                                                                                                               | 200       |
| `/ready`  | Бутстраперы завершены и БД доступна (кэш фоновой проверки). Для `worker` — то же: обработчики задач запущены, БД жива                | 200 / 503 |
| `/health` | Живые проверки с таймаутом 2 с: Postgres `SELECT 1`, Redis `PING` (если `REDIS_URL`), проверки модулей; SMTP — только факт настройки | 200 / 503 |

Ответ `/health`: `{ status: "ok" | "degraded", ready, role, services: { database, redis, smtp, ...модули } }`,
статусы сервисов — `ok`, `error`, `not_configured`. 503 — если упала БД, Redis
(настроенный) или критичная проверка модуля. Вне production добавляются
`uptime`, `version`, `memory`.

Проверка модуля (например, pg-boss):

```ts
@Injectable()
export class JobsHealthIndicator implements IHealthIndicator {
  readonly name = "jobs";
  // readonly critical = false; — отказ не переводит /health в 503
  constructor(@inject(PgBossService) private readonly _boss: PgBossService) {}
  check() {
    return this._boss.isRunning();
  }
}
// providers: [asHealthIndicator(JobsHealthIndicator)]
```

Проверки берутся из DI-контейнера на каждом запросе (они появляются после
загрузки модулей); каждая — с таймаутом, исключение = `error`.

## Тесты

- `metrics.test.ts` — метка `route` как шаблон, `unmatched`, счётчик ошибок по
  коду, пробы не учитываются, метрики задач, gauge сокетов.
- `error-reporter.test.ts` — только 5xx, контекст запроса, ошибки процесса, flush.
- `health.test.ts` — таймауты, `probeRedis`, критичность проверок.
- `src/routing/system-routes.test.ts` — `/ready` (роль worker), `/health`
  (БД, Redis, SMTP, проверки модулей), `/metrics` (токен, выключение).
