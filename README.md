# WG Admin

Админка WireGuard: бэкенд (панель управления) и воркеры узлов на Go. Бэкенд
хранит желаемое состояние каждой ноды — интерфейсы и пиры, точки подключения
через релей, реплики интерфейсов, пробросы портов, SOCKS5-прокси через mTLS.
На ноде (VPS) работает универсальный агент
[github.com/epifanovmd/agent](https://github.com/epifanovmd/agent) 1.0.1: он
держит исходящее соединение с бэкендом (WebSocket; в продакшене — через HTTPS),
хранит настройки, присылает метрики узла и обновляется сам. Работу с WireGuard
делают воркеры проекта `wg` и `socks`, которые запускает агент: бэкенд передаёт
им желаемое состояние настройками, воркеры приводят сервер в соответствие и
отдают метрики. Входящие порты агенту не нужны; агент ставится одной командой
или из админки по SSH.

Как устроена система (агенты и воркеры, версии состояния, релей, реплики,
пробросы, прокси, статистика, доступ, задачи, диагностика) —
[docs/WIREGUARD.md](docs/WIREGUARD.md). Воркеры, их сборки, установка на узел и
локальный запуск агента — [agent/README.md](agent/README.md). Модули бэкенда
описаны в `README.md` внутри каждого `src/modules/<модуль>`; связь с агентами —
`src/modules/agent/README.md`.

## Стек

- Бэкенд: Node.js >= 24, TypeScript, Koa + tsoa (маршруты и OpenAPI из
  декораторов), Inversify (DI), TypeORM + PostgreSQL, pg-boss (очередь задач
  на Postgres), Redis (между процессами), Socket.IO, Zod, pino, prom-client,
  Sentry, Nodemailer + EJS; сборка `tsc`.
- Агенты: agent 1.0.1 на узлах (служба systemd), на бэкенде — пакет `agent-sdk`
  той же версии (зависимость из GitHub Release).
- Воркеры узла: Go 1.26.9 (toolchain в `agent/go.mod`), сборки linux и darwin ×
  amd64 и arm64.
- Тесты: Mocha + Chai + Sinon (юнит и e2e), `go test`.

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
agent/               ← воркеры узла wg и socks (Go), сборки для узлов, локальный агент
templates/           ← шаблоны писем
test/e2e/            ← интеграционный набор (настоящий сервер + Postgres, Redis, Mailpit)
test/smoke/          ← образ узла для smoke-стенда
scripts/             ← генератор модуля, Go в контейнере, проверка версий воркеров, дамп БД
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

Агент на этой машине (подробно — [agent/README.md](agent/README.md), «Локальный
запуск»): регистрируется общим токеном `AGENT_BOOTSTRAP_TOKEN` из
`.env.development`, метка ноды — `AGENT_NODE_ID`; воркер wg — в имитации
(`WG_DRY_RUN`), системные команды не выполняются.

```sh
yarn agent:release      # один раз: воркеры wg и socks в agent/release
yarn agent              # агент на переднем плане (agent/dev.sh run; программу агента
                        # скачает с GitHub в agent/dist, если её там нет)
```

Воркеры без установки Go — в контейнере golang (версия — toolchain из
`agent/go.mod`): `scripts/go-agent.sh test | vet | tidy | fmt | build [os [arch]]`.

## Команды

Все команды — из корня репозитория.

**Разработка**

| Команда                             | Что делает                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `yarn dev`                          | генерация маршрутов + сервер с перезапуском при изменениях (роль `all`, миграции при старте) |
| `yarn dev:types`                    | проверка типов в режиме watch                                                                |
| `yarn gen:module <имя> [--dry-run]` | каркас нового модуля по конвенциям (`--dry-run` — только список файлов)                      |

**Проверки**

| Команда                  | Что делает                                                              |
| ------------------------ | ----------------------------------------------------------------------- |
| `yarn lint` / `lint:fix` | ESLint (`src`, `test`) / с автоисправлением                             |
| `yarn prettier:fix`      | форматирование `src/**/*.ts`                                            |
| `yarn typecheck`         | проверка типов (`tsc --noEmit`)                                         |
| `yarn test`              | юнит-тесты (`src/**/*.test.ts`)                                         |
| `yarn test:file <путь>`  | один файл тестов                                                        |
| `yarn test:e2e`          | интеграционные тесты: настоящий сервер поверх Postgres, Redis и Mailpit |

**Сборка, кодогенерация, база**

| Команда                                        | Что делает                                                    |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `yarn generate`                                | маршруты и OpenAPI из декораторов (`src/routing`, коммитятся) |
| `yarn build`                                   | генерация + компиляция `src/` → `build/`                      |
| `yarn server`                                  | запуск production-сборки                                      |
| `yarn migration:generate src/migrations/<Имя>` | миграция из разницы сущностей и схемы БД                      |
| `yarn migration:run` / `migration:revert`      | применить ожидающие миграции / откатить последнюю             |

**Агент и воркеры узла**

| Команда                                                           | Что делает                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `yarn agent:release`                                              | воркеры проекта в `agent/release`: сборки wg и socks, `manifest.json`            |
| `yarn agent:fetch [версия…]`                                      | скачать сборки агента с GitHub в `agent/dist/agent-<версия>` (разработка и e2e)  |
| `yarn agent`                                                      | локальный агент на переднем плане (воркер wg — в имитации)                       |
| `yarn agent:start` / `agent:stop` / `agent:status` / `agent:logs` | локальный агент в фоне: запуск, остановка, состояние, журнал                     |
| `scripts/go-agent.sh test` / `vet` / `tidy` / `fmt`               | тесты, `go vet`, `go mod tidy`, `gofmt` воркеров (Go в контейнере)               |
| `scripts/go-agent.sh build [os [arch]]`                           | сборки воркеров в `agent/dist` (без аргументов — linux и darwin × amd64 и arm64) |

**Makefile — сервер по SSH** (настройки — `.env.deploy`, образец `.env.deploy.example`;
любое значение переопределяется в команде: `make deploy SSH_HOST=…`)

Обычная выкладка — push в `main`: CI проверяет код, собирает образ (воркеры wg и socks
подписаны ключом из секрета `AGENT_SIGNING_KEY`), отправляет его в GHCR с тегом коммита и
запускает на хосте `make release TAG=<sha>`; после выкладки `latest` указывает на этот
коммит. Хост только скачивает образ. Откат — `make release TAG=<sha прошлого коммита>` или
ручной запуск workflow Deploy с этим тегом. `make deploy` (сборка на хосте) — запасной путь
без CI: воркеры в нём без подписи.

| Команда                            | Что делает                                                              |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `make deploy`                      | исходники на хост, сборка образа там же, миграции, запуск               |
| `make release TAG=<sha>`           | готовый образ из GHCR: compose-файлы, `pull`, миграции, запуск          |
| `make env`                         | секреты (`.env.production`) на хост                                     |
| `make sync` / `compose`            | исходники (rsync, кроме `.deployignore`) / только compose-файлы на хост |
| `make build` / `pull`              | собрать образ на хосте / скачать из registry                            |
| `make migrate`                     | применить миграции на хосте (одноразовый `migrate`)                     |
| `make up` / `down`                 | запустить / остановить стек на хосте                                    |
| `make status` / `logs` / `restart` | состояние сервисов / журнал `api` и `worker` / их перезапуск            |
| `make db-dump` / `db-restore`      | дамп базы с хоста в файл / восстановление из файла (`scripts/db`)       |

**Makefile — на этой машине** (без `.env.deploy`)

| Команда                                       | Что делает                                                |
| --------------------------------------------- | --------------------------------------------------------- |
| `make image`                                  | собрать образ локально                                    |
| `make local-up` / `local-down` / `local-logs` | production-стек в Docker: запустить / остановить / журнал |

pre-commit (lefthook): prettier и eslint по staged-файлам, typecheck, юнит-тесты.

### Тесты

- **Юнит** — `src/**/*.test.ts`. Интеграционный тест очереди задач
  (`jobs.integration.test.ts`) выполняется при `TEST_DATABASE_URL`
  (одноразовая база), иначе пропускается.
- **E2E** — `test/e2e/*.e2e.ts`: настоящий сервер (`APP_ROLE=all`) против
  Postgres, Redis и Mailpit, сценарии всех эндпоинтов по HTTP и сокетам;
  последний тест проверяет, что вызван каждый эндпоинт спецификации. Стенд
  пересоздаёт базу (только с `e2e`/`test` в имени) и чистит отдельную базу
  Redis. Параметры — `E2E_*`. Сценарии домена идут с фейковым агентом на
  WebSocket (`test/e2e/fake-agent.ts`, `node-agent.ts`); `agents.e2e.ts` и
  `agent-update.e2e.ts` — настоящий агент и воркеры. Агент — сборки с GitHub,
  скачанные заранее (`yarn agent:fetch` и `yarn agent:fetch 1.0.1` — для
  обновления агента): стенд раздаёт его бэкенду со своего сервера, в GitHub
  тесты не ходят. Воркеры — сборки из `agent/release` или `agent/dist`, стенд
  подписывает их своим ключом проекта. Чего нет — сценарии пропускаются.
- **Воркеры** — `go test` в `agent/` (`scripts/go-agent.sh test`); воркер wg на
  настоящем Linux — `agent/workers/wg/linux-check.sh`.
- **Smoke** — `test/smoke`: образ узла (`Dockerfile.agent`, `agent.yaml`) готов,
  сценарий `wg-smoke.sh` написан под прежний API бэкенда и сейчас не работает.

### Миграции

Схема живёт только в миграциях (автосинхронизации нет). Новая миграция
генерируется из сущностей и добавляется в `src/migrations/index.ts`; применённые
миграции не редактируются. CI проверяет, что миграции применяются на чистую БД
и что сущности не разошлись со схемой. `DB_MIGRATIONS_RUN=false` — миграции
отдельным шагом (сервис `migrate` в compose); сервер с отставшей схемой не
стартует.

## Docker и деплой

`Dockerfile` — один образ для ролей `api`, `worker` и миграций; в нём же
собираются воркеры проекта для узлов (`/app/agent/release`, стадии
`agent-workers` и `agent-release`): wg, socks и их `manifest.json`. Агента в
образе нет: бэкенд берёт его и `install.sh` из релизов GitHub
(`AGENT_RELEASES_GITHUB`, диапазон `^1`) и сам замечает новые версии — ради
новой версии агента образ не пересобирают. Подписать воркеры ключом проекта —
необязательный секрет BuildKit `agent_signing_key`
(`docker build --secret id=agent_signing_key,env=AGENT_SIGNING_KEY .`; в
`release.yml` — секрет репозитория `AGENT_SIGNING_KEY`; бэкенду —
`AGENT_UPDATE_PUBLIC_KEY`); без него обновить воркеры с бэкенда нельзя. Стадии сборки кросс-компилируют на платформе сборщика;
production-зависимости, непривилегированный пользователь, `tini` как PID 1,
read-only файловая система. Версию сборки (`APP_VERSION`, `APP_COMMIT`,
`APP_BUILT_AT`) передают build-аргументами `make` и `release.yml`; она видна в
`GET /api/v1/app/version`.

`docker-compose.yml` — production-стек: `api`, `worker`, одноразовый `migrate`,
Redis; по профилю `https` — Caddy с сертификатом для `APP_DOMAIN`
(`deploy/Caddyfile`). Postgres — `docker-compose.postgres.yml` или внешний
(`POSTGRES_HOST`). Секреты — `.env.production`; обязателен `WG_SECRETS_KEY`
(`openssl rand -hex 32`): им шифруются ключи WireGuard в БД; значения настроек
воркеров шифруются ключом `AGENT_CONFIGS_KEY`. В compose одна копия `api` —
пересылка вызовов агентов между копиями (`AGENT_RELAY_*`) не нужна.

```sh
export COMPOSE_FILE=docker-compose.yml:docker-compose.postgres.yml
TAG=v1.2.3 docker compose pull          # или: docker compose build api
docker compose run --rm migrate
docker compose up -d
docker compose up -d --scale api=3      # реплики API (API_PORTS=8181-8183; агентам — AGENT_RELAY_*)
```

Остановка по SIGTERM: `/ready` → 503, пауза для балансировщика, дожидание
запросов и активных задач, затем сокеты и БД.

`Makefile` (по SSH, настройки — `.env.deploy`, образец `.env.deploy.example`):

- `make release TAG=<sha>` — готовый образ коммита из GHCR (его собирает CI), миграции,
  запуск — так выкладывает CI;
- `make deploy` — запасной путь: исходники на хост (rsync, исключения `.deployignore`),
  сборка там же (воркеры без подписи), миграции, запуск;
- `make env` — `.env.production` на хост; `status`, `logs`, `restart`, `down`;
- `make db-dump` / `make db-restore` — дамп базы с хоста и обратно
  (`scripts/db`);
- без `.env.deploy`: `make image` — образ локально, `make local-up|local-down|local-logs`
  — стек на этой машине.

## CI

- `ci.yml` (push и pull request в `main`): generate и сверка `src/routing`,
  lint, typecheck, юнит-тесты, сборка; воркеры узла — подняты ли
  `agent/workers/<имя>/VERSION` при изменении их кода с последнего тега и
  совпадает ли Go в Dockerfile-ах с toolchain `go.mod`
  (`scripts/check-agent-version.sh`), `go mod tidy`, gofmt, vet под linux и
  darwin, `go test -race`, сборка linux и darwin × amd64 и arm64; shellcheck
  скриптов; миграции на
  чистой БД, дрейф схемы и интеграционный тест очереди задач; e2e; аудит
  зависимостей; образ + Trivy. После всех проверок `main` — деплой
  (`deploy.yml`, если задана переменная репозитория `DEPLOY_ENV` и секрет
  `SSH_PRIVATE_KEY`).
- `release.yml` (тег `v*` на коммите из `main`): образ amd64/arm64 в GHCR
  (версия сборки — тег).

## Лицензия

MIT
