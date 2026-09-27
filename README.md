# WG Admin

Админка WireGuard: бэкенд (панель управления) и агент нод на Go. Бэкенд хранит
желаемое состояние каждой ноды — интерфейсы и пиры, точки подключения через
релей, реплики интерфейсов, пробросы портов, SOCKS5-прокси через mTLS, — агент
на VPS забирает его по исходящему HTTPS, приводит сервер в соответствие и шлёт
статистику. Входящие порты агенту не нужны; агент ставится одной командой или
из админки по SSH и обновляется бинарём с бэкенда.

Как устроена система (агенты, версии состояния, релей, реплики, пробросы,
прокси, статистика, доступ, задачи, диагностика) — [docs/WIREGUARD.md](docs/WIREGUARD.md).
Агент — [agent/README.md](agent/README.md). Модули бэкенда описаны в
`README.md` внутри каждого `src/modules/<модуль>`.

## Стек

- Бэкенд: Node.js >= 24, TypeScript, Koa + tsoa (маршруты и OpenAPI из
  декораторов), Inversify (DI), TypeORM + PostgreSQL, pg-boss (очередь задач
  на Postgres), Redis (между процессами), Socket.IO, Zod, pino, prom-client,
  Sentry, Nodemailer + EJS; сборка `tsc`.
- Агент: Go (статический бинарь linux/amd64 и arm64), служба systemd.
- Тесты: Mocha + Chai + Sinon (юнит и e2e), `go test`, smoke-стенд в Docker.

## Структура

```
src/
  main.ts / app.ts   ← точка входа и жизненный цикл
  app.module.ts      ← корневой модуль: список модулей
  config.ts          ← валидированная конфигурация окружения
  core/              ← ядро: DI, модули, auth, ошибки, EventBus, задачи, наблюдаемость
  common/, middleware/
  data-source.ts     ← DataSource (сущности — из модулей, миграции — из списка)
  routing/           ← сгенерированные маршруты и спецификация (не править вручную)
  migrations/        ← миграции и их упорядоченный список (index.ts)
  modules/           ← платформа (auth, user, role, jobs, …) и домен WireGuard (wg-*)
agent/               ← агент нод (Go)
templates/           ← шаблоны писем
test/e2e/            ← интеграционный набор (настоящий сервер + Postgres, Redis, Mailpit)
test/smoke/          ← smoke-стенд WG-домена в Docker (бэкенд + агенты в контейнерах)
scripts/             ← генератор модуля, Go в контейнере, дамп и восстановление БД
deploy/              ← конфиг Caddy (HTTPS)
docs/                ← устройство системы
```

Архитектура и правила кода: [ARCHITECTURE.md](ARCHITECTURE.md),
[MODULE-CHEATSHEET.md](MODULE-CHEATSHEET.md), [CONVENTIONS.md](CONVENTIONS.md),
[CLEAN-CODE.md](CLEAN-CODE.md), [DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md).

## Разработка

Нужны Node.js >= 24, Yarn 1.22, Docker.

```sh
yarn
cp .env.example .env.development
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, Mailpit
yarn dev                                         # генерация маршрутов + tsx watch
```

Переменные окружения с описанием — в `.env.example`; читается `.env.<NODE_ENV>`,
затем `.env`. Конфигурация валидируется при старте; скомпилированный запуск без
`NODE_ENV` работает как production, где небезопасные умолчания (пустой пароль
БД, CORS `*`, нет Redis, нет `WG_SECRETS_KEY`) — ошибка запуска. Письма без SMTP
в development пишутся в лог; Mailpit — http://localhost:8025.

`yarn dev` запускает процесс в роли `all` (HTTP, сокеты и задачи) и применяет
миграции. API — `/api/v1/...`, Swagger UI — `/api-docs`; системные маршруты —
`/ping`, `/ready`, `/health`, `/metrics`. Роль процесса — `APP_ROLE`: `api`
(HTTP и сокеты), `worker` (задачи и cron), `all`.

Агент без установки Go — в контейнере golang (версия из `agent/go.mod`):

```sh
scripts/go-agent.sh test | vet | tidy | build [amd64|arm64]
```

## Команды

```sh
yarn generate        # tsoa: src/routing/routes.ts + swagger.json (коммитятся)
yarn lint            # eslint (yarn lint:fix, yarn prettier:fix)
yarn typecheck       # tsc --noEmit (watch: yarn dev:types)
yarn test            # юнит-тесты (один файл: yarn test:file <path>)
yarn test:e2e        # интеграционный набор, нужен docker-compose.dev.yml
yarn build           # генерация + tsc: src/ → build/
yarn server          # запуск сборки (node build/main.js)
yarn gen:module <name> [--dry-run]              # каркас модуля по конвенциям
yarn migration:generate src/migrations/<Name>   # миграция из изменений сущностей
yarn migration:run | migration:revert
```

pre-commit (lefthook): prettier и eslint по staged-файлам, typecheck, юнит-тесты.

### Тесты

- **Юнит** — `src/**/*.test.ts`. Интеграционный тест очереди задач
  (`jobs.integration.test.ts`) выполняется при `TEST_DATABASE_URL`
  (одноразовая база), иначе пропускается.
- **E2E** — `test/e2e/*.e2e.ts`: настоящий сервер (`APP_ROLE=all`) против
  Postgres, Redis и Mailpit, сценарии всех эндпоинтов по HTTP и сокетам;
  последний тест проверяет, что вызван каждый эндпоинт спецификации. Стенд
  пересоздаёт базу (только с `e2e`/`test` в имени) и чистит отдельную базу
  Redis. Параметры — `E2E_*`.
- **Smoke** — `test/smoke/wg-smoke.sh`, запускается вручную: бэкенд и агенты в
  Linux-контейнерах с настоящим WireGuard, релей, пробросы через IPIP с
  аварийным путём, SOCKS5 через mTLS, реплики с переключением, обновление
  агента, автономный старт, откат. Хост не затрагивается.

  ```sh
  docker build -t wg-admin-api:test .
  docker build -f test/smoke/Dockerfile.agent --build-arg AGENT_VERSION=2.0.0-smoke -t wg-admin-agent:test .
  bash test/smoke/wg-smoke.sh
  ```

### Миграции

Схема живёт только в миграциях (автосинхронизации нет). Новая миграция
генерируется из сущностей и добавляется в `src/migrations/index.ts`; применённые
миграции не редактируются. CI проверяет, что миграции применяются на чистую БД
и что сущности не разошлись со схемой. `DB_MIGRATIONS_RUN=false` — миграции
отдельным шагом (сервис `migrate` в compose); сервер с отставшей схемой не
стартует.

## Docker и деплой

`Dockerfile` — один образ для ролей `api`, `worker` и миграций; в нём же
собираются бинари агента (amd64 и arm64), которые бэкенд раздаёт при установке
и обновлении. Стадии сборки кросс-компилируют на платформе сборщика;
production-зависимости, непривилегированный пользователь, `tini` как PID 1,
read-only файловая система.

`docker-compose.yml` — production-стек: `api`, `worker`, одноразовый `migrate`,
Redis; по профилю `https` — Caddy с сертификатом для `APP_DOMAIN`
(`deploy/Caddyfile`). Postgres — `docker-compose.postgres.yml` или внешний
(`POSTGRES_HOST`). Секреты — `.env.production`; обязателен `WG_SECRETS_KEY`
(`openssl rand -hex 32`): им шифруются ключи WireGuard в БД.

```sh
export COMPOSE_FILE=docker-compose.yml:docker-compose.postgres.yml
TAG=v1.2.3 docker compose pull          # или: docker compose build api
docker compose run --rm migrate
docker compose up -d
docker compose up -d --scale api=3      # реплики API (API_PORTS=8181-8183)
```

Остановка по SIGTERM: `/ready` → 503, пауза для балансировщика, дожидание
запросов и активных задач, затем сокеты и БД.

`Makefile` (по SSH, настройки — `.env.deploy`, образец `.env.deploy.example`):

- `make deploy` — исходники на хост (rsync, исключения `.deployignore`), сборка
  там же, миграции, запуск;
- `make release TAG=v1.2.3` — готовый образ из GHCR;
- `make env` — `.env.production` на хост; `status`, `logs`, `restart`, `down`;
- `make db-dump` / `make db-restore` — дамп базы с хоста и обратно
  (`scripts/db`);
- без `.env.deploy`: `make image` — образ локально, `make local-up|local-down|local-logs`
  — стек на этой машине.

## CI

- `ci.yml` (push и pull request в `main`): generate и сверка `src/routing`,
  lint, typecheck, юнит-тесты, сборка; агент — `go mod tidy`, gofmt, vet,
  `go test -race`, сборка под amd64/arm64; shellcheck скриптов; миграции на
  чистой БД, дрейф схемы и интеграционный тест очереди задач; e2e; аудит
  зависимостей; образ + Trivy. После всех проверок `main` — деплой
  (`deploy.yml`, если задана переменная репозитория `DEPLOY_ENV` и секрет
  `SSH_PRIVATE_KEY`).
- `release.yml` (тег `v*` на коммите из `main`): образ amd64/arm64 в GHCR.

## Лицензия

MIT
