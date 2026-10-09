# CLAUDE.md

## Язык ответа

Отвечать на русском.

## Проект

WG Admin — админка WireGuard: бэкенд (модульный монолит на Node.js + TypeScript) и
воркеры узла на Go (`agent/workers`: `wg`, `socks`), которые запускает агент 1.1.0
([github.com/epifanovmd/agent](https://github.com/epifanovmd/agent)) на нодах; на
бэкенде связь с агентами — пакет `agent-sdk` в модуле `agent`. Бэкенд: Koa + tsoa (маршруты и OpenAPI из декораторов),
Inversify (DI), TypeORM + PostgreSQL, pg-boss (очередь задач на Postgres), Redis
(между процессами), Socket.IO, Zod, pino, prom-client, Sentry; тесты —
Mocha, Chai, Sinon; сборка `tsc`. Node >= 24. Роль процесса — `APP_ROLE=api|worker|all`.
Устройство системы — `docs/WIREGUARD.md`, воркеры, выпуск и установка —
`agent/README.md`, связь с агентами — `src/modules/agent/README.md`.

## Команды

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, Mailpit
yarn dev                  # генерация маршрутов + tsx watch (APP_ROLE=all)
yarn generate             # tsoa: routes.ts + swagger.json
yarn build                # генерация + tsc: src/ → build/
yarn server               # production-сборка (node build/main.js)
yarn lint | lint:fix | prettier:fix
yarn typecheck            # проверка типов (yarn dev:types — watch)
yarn test                 # юнит, src/**/*.test.ts (один файл: yarn test:file <path>)
yarn test:e2e             # интеграционный набор test/e2e/*.e2e.ts (нужен dev-compose)
yarn gen:module <name>    # каркас модуля по конвенциям (--dry-run — список файлов)
yarn migration:generate src/migrations/<Name> | migration:run | migration:revert
yarn agent:release        # воркеры wg, socks в agent/release (агента бэкенд берёт с GitHub сам)
yarn agent:fetch [версия] # выпуск агента с GitHub в agent/dist (локальный агент, e2e)
yarn agent                # локальный агент (agent/dev.sh run; agent:start|stop|status|logs)
scripts/go-agent.sh test | vet | tidy | fmt | build [os [arch]]   # воркеры: Go в контейнере
```

Перед завершением задачи обязательны: `yarn generate`, `yarn lint`, `yarn typecheck`,
`yarn test`; при изменении API, схемы БД или инфраструктуры — ещё `yarn test:e2e`; при
изменении воркеров (`agent/`) — gofmt, `go vet`, `go test` и поднять
`agent/workers/<имя>/VERSION` изменённого воркера (общий код `agent/internal`, `go.mod`,
`go.sum` — оба). Формат настроек, ответов и метрик воркеров (`agent/internal/desired`, манифесты
воркеров) — зеркало `src/modules/wg-agent/wg-worker.contract.ts`, менять синхронно.

## Никогда не редактировать вручную

- `src/routing/routes.ts` и `src/routing/swagger.json` — генерация tsoa (коммитятся
  актуальными, CI сверяет).
- Применённые миграции в `src/migrations/` — новое изменение схемы = новая миграция
  (генерируется из сущностей и добавляется в `src/migrations/index.ts`).

## Правила (обязательные)

- Модульный монолит: код живёт в модуле-владельце (`src/modules/<feature>/`);
  контроллер → сервис → репозиторий → сущность; наружу — только DTO.
- Ядро (`src/core`, `src/types`) не импортирует модули — страж-тест. Расширение —
  только токенами-реестрами (`asSecurityScheme`, `asJobHandler`, `asJobAccessPolicy`,
  `asSocketRoomProvider/Policy`, `ROUTE_PROVIDER`, `asHealthIndicator`,
  `definePermissions` и т. п.).
- Регистрация в IoC — только через `@Module.providers`; `@Injectable()` — маркер.
  Контроллеры тоже в `providers`. Сущности модуля — в `@Module.entities`.
- Состояние, общее для процессов (лимиты, presence, отзыв токенов, кэши), — в
  Redis/БД, не в памяти процесса.
- Фоновая работа — задачи очереди (`IJobHandler` + `asJobHandler`), постановка с
  `manager` транзакции; периодическая — только `cron` в `definition` (не setInterval и
  не advisory-lock).
- Реакция между модулями — только через `EventBus`, события — после транзакции.
  Сервисы не инжектят транспорт реального времени; доставка — в listener через эмиттер.
  Входящие события сокета — только через `onValidated` (схема + лимит).
- Чужой модуль импортируется через его `index.ts`; внутри модуля — относительные пути.
- Маршруты — `api/v1/...`; на контроллере `@Response<IErrorResponseDto>("default")`;
  path-id — тип `UUID`; создание — 201, без тела — 204.
- Ошибки — доменные коды `defineErrors("PREFIX", …)` в `<feature>.errors.ts`,
  сообщения на русском; конфликт состояния — 409; `throw new Error` в бизнес-коде нет.
- Списки — `IPaginatedDto` (`normalizePagination` + `toPage`), ленты — `ICursorPageDto`.
- Security-scope — право (`permission:<домен>:<действие>`), не роль; права модуля —
  `definePermissions` в `<feature>.permissions.ts`.
- Валидация входа — Zod-схемой декоратором на маршруте; длины совпадают с колонками БД.
- Nullable-колонка → `| null`. Enum-ы — в `<feature>.types.ts`. `@Path()` на каждом
  path-параметре.
- **Все функции — стрелочные.** `function`-объявления и выражения запрещены (хелперы,
  type guards, фабрики, callback-и); методы классов остаются методами. Хелпер объявляется
  выше первого использования — у `const` нет hoisting. Проверяется линтером.
- Логи — только через структурированный логгер; `console.*` запрещён.
- Новый эндпоинт — со сценарием в `test/e2e` (тест покрытия спецификации упадёт иначе).
- **Багфикс через тест.** Сначала тест, воспроизводящий баг и падающий на текущем коде →
  правка → зелёный прогон. Тест остаётся в кодовой базе.

## Workflow

Любая задача (фича, баг, рефакторинг) проходит четыре этапа:

1. **Анализ** — прочитать релевантные файлы `.claude/memory/` и затрагиваемый код,
   определить scope модулей и файлов, выявить риски и edge cases.
2. **План** — пошаговый план с конкретными файлами, разбитый на мелкие итерации
   (каждая — рабочее состояние). Показать пользователю, дождаться подтверждения.
3. **Выполнение** — по одной итерации; после каждой — lint и typecheck; не переходить
   дальше, пока текущая не стабильна. Сообщать прогресс.
4. **Проверка** — `yarn generate`, `yarn lint`, `yarn typecheck`, `yarn test`
   (и `yarn test:e2e` при изменении API/схемы/инфраструктуры); краткое резюме.

## Комментарии в коде

- Разрешены: JSDoc к публичным контрактам, методам контроллеров (попадает в OpenAPI),
  декораторам и хелперам ядра.
- В теле функций — только если место неочевидное и без комментария нельзя.
- Комментарий — краткий, по факту. Не описывать историю изменений.
- Если комментарий устарел — переписать заново, а не дополнять.

## Документация

Проектная документация (`README.md`, `ARCHITECTURE.md`, `MODULE-CHEATSHEET.md`,
`CONVENTIONS.md`, `CLEAN-CODE.md`, `DESIGN-PRINCIPLES.md`) описывает **общие
принципы, архитектуру и правила** — без описания конкретных модулей, сущностей,
эндпоинтов, событий и имён.

**Эти документы меняются только в исключительных случаях** — когда в проекте
действительно меняется архитектура, принцип, паттерн или правило. Правка задачи, даже
изменившая архитектурный факт, не повод править документ попутно: сообщить об этом и
вынести правку документации в отдельную задачу. Проектную конкретику (имена модулей,
сущностей, сервисов, файлов, счётчики) в них не добавлять.

Локальная память `.claude/memory/` — наоборот, живой справочник: её можно и нужно
обновлять без ограничений при каждой задаче — проверенные факты, gotcha, точные
файловые карты, актуальные списки модулей и событий.

## Где читать

Общие принципы (без проектной конкретики):

| Вопрос                                                                                                     | Документ                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Жизненный цикл, роли процесса, модули, DI, точки расширения, доступ, события, задачи, файлы, наблюдаемость | [ARCHITECTURE.md](ARCHITECTURE.md)                                           |
| Куда положить новый код, чек-лист нового модуля                                                            | [MODULE-CHEATSHEET.md](MODULE-CHEATSHEET.md)                                 |
| Именование, контроллеры, ошибки, пагинация, задачи, файлы, тесты, проверки                                 | [CONVENTIONS.md](CONVENTIONS.md)                                             |
| Clean code, SOLID, паттерны                                                                                | [CLEAN-CODE.md](CLEAN-CODE.md), [DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md) |

Конкретика проекта (проверенные факты, gotcha, точные файловые карты) — в
[.claude/memory/MEMORY.md](.claude/memory/MEMORY.md): architecture, access control,
modules, patterns, reference. Загружай тематический файл, когда работаешь в
соответствующей области. Внутри каждого модуля есть `README.md` с описанием его
сущностей, эндпоинтов и событий — это часть кода модуля, а не общей документации.
Устройство WG-домена — [docs/WIREGUARD.md](docs/WIREGUARD.md), воркеры узла —
[agent/README.md](agent/README.md).
