# Модуль Socket

Инфраструктурный модуль реального времени на базе Socket.IO. Предоставляет WebSocket-сервер с JWT-аутентификацией, реестр подключённых клиентов, типизированный эмиттер событий и точки расширения для других модулей.

## Структура файлов

```
src/modules/socket/
├── socket.module.ts                  # Объявление модуля (@Module) + bootstrapper
├── socket-server.service.ts          # Обёртка над Socket.IO Server
├── socket-auth.middleware.ts         # JWT-аутентификация при подключении
├── socket-client-registry.ts        # Реестр подключённых клиентов (isOnline)
├── socket-emitter.service.ts        # Типизированный эмиттер событий
├── socket.bootstrap.ts              # Bootstrap: запуск сервера, регистрация handlers/listeners
├── socket-handler.interface.ts      # ISocketHandler + SOCKET_HANDLER токен
├── socket-event-listener.interface.ts # ISocketEventListener + SOCKET_EVENT_LISTENER токен
├── socket.helpers.ts                # Хелперы asSocketHandler(), asSocketListener()
├── socket-validation.ts             # onValidated(): схема, лимит частоты, ack с кодом ошибки
├── socket-rooms.ts                  # asSocketRoomProvider(), asSocketRoomPolicy()
├── socket.types.ts                  # Типы TSocket, TServer, ISocketEvents, ISocketEmitEvents
└── index.ts                         # Публичный API модуля
```

## Компоненты

### SocketServerService

Обёртка над `Socket.IO Server`. Создаётся с CORS-настройками из конфига, транспорт только WebSocket.

| Метод         | Описание                   |
| ------------- | -------------------------- |
| `io` (getter) | Экземпляр Socket.IO Server |
| `close()`     | Остановить сервер          |

### SocketAuthMiddleware

JWT-аутентификация при каждом подключении. Извлекает токен из `socket.handshake.auth.token`, верифицирует через `TokenService.verifyAccess` (с проверкой отзыва сессии) и записывает `AuthContext` в `socket.data`.

Срок токена (`watch(socket)`, вызывает `SocketBootstrap` на подключении): в момент `exp` сервер шлёт `auth:expired { graceMs }` и через `SOCKET_AUTH_GRACE_MS` (30 с) рвёт соединение, если клиент не прислал `auth:refresh { accessToken }` (ack `{ ok, expiresAt?, error? }`). Новый токен принимается только той же сессии и того же пользователя и не должен быть отозван; успех обновляет `socket.data` и перепланирует срок. Завершённая сессия рвёт свои сокеты через `SessionTerminatedEvent` → `disconnectSession` (модуль session).

### SocketClientRegistry

Присутствие пользователей для всех реплик. С Redis — `SET presence:<userId>` из id
соединений с TTL 60 с и heartbeat каждые 20 с (упавшая реплика не оставляет «вечный
онлайн»); без Redis — память процесса. Хранилище подменяется токеном `PRESENCE_STORE`.
Сейчас реестр нужен только самому `SocketBootstrap`: по нему публикуются
`UserOnlineEvent` (первое соединение) и `UserOfflineEvent` (последнее закрыто);
подписчиков у этих событий нет — рассылки присутствия клиентам нет.

| Метод                        | Описание                                             |
| ---------------------------- | ---------------------------------------------------- |
| `register(userId, socket)`   | Зарегистрировать соединение (async)                  |
| `unregister(userId, socket)` | Удалить соединение (async)                           |
| `isOnline(userId)`           | Есть ли соединения на любой реплике (async)          |
| `filterOnline(userIds)`      | Кто из списка онлайн — одним проходом                |
| `startHeartbeat()`, `stop()` | Продление TTL своих соединений; снятие при остановке |

### SocketEmitterService

Типизированный сервис отправки событий.

| Метод                                  | Описание                                               |
| -------------------------------------- | ------------------------------------------------------ |
| `toUser(userId, event, ...args)`       | Отправить событие пользователю (room `user_${userId}`) |
| `toRoom(room, event, ...args)`         | Отправить в комнату                                    |
| `broadcast(event, ...args)`            | Широковещательная рассылка                             |
| `joinRoom` / `leaveRoom`               | Все сокеты пользователя входят в комнату / выходят     |
| `disconnectUser` / `disconnectSession` | Разорвать соединения пользователя / сессии             |

Всё работает на всех репликах через Redis-адаптер Socket.IO (при `REDIS_URL`).

### SocketBootstrap (IBootstrap)

Инициализация при старте приложения:

1. Регистрация JWT middleware (на роли `worker` клиентские подключения не принимаются — только слушатели).
2. При подключении: сначала — синхронно, до любого `await` — подписки
   `room:subscribe`/`room:unsubscribe` по политикам `ISocketRoomPolicy` (`asSocketRoomPolicy`):
   клиент подписывается сразу по `connect`, запрос не должен теряться. Затем присутствие в
   `SocketClientRegistry`, комната `user_${userId}`, комнаты от всех `ISocketRoomProvider`
   (`asSocketRoomProvider`), `UserOnlineEvent` (если это первое соединение пользователя),
   `ISocketHandler.onConnection()`.
3. При отключении: снятие присутствия; последнее соединение — `UserOfflineEvent`.
4. Вызов `register()` на всех `ISocketEventListener` — на всех ролях процесса.

### onValidated — входящие события с проверкой

`onValidated(socket, event, schema, handler, { rateLimit? })` — единственный способ
подписки доменных хендлеров на события клиента:

1. **Частота** — token bucket в памяти сокета (`WeakMap` по сокету, отдельно на событие):
   `{ perSecond, burst? }` (`burst` по умолчанию = `perSecond`). Превышение → ack
   `SOCKET_RATE_LIMITED`; без ack событие молча отбрасывается (ответ `error` сам по себе
   умножал бы трафик).
2. **Схема** — Zod `safeParseAsync`; в обработчик попадает результат парсинга (лишние поля
   отброшены, `transform` применён). Ошибка → `VALIDATION_ERROR`, `details` — поле →
   сообщение.
3. **Обработчик** — `HttpException` (в т. ч. доменные `defineErrors`) → его `code` и
   `message`; прочие ошибки → `SOCKET_INTERNAL` (текст наружу не уходит, пишется в лог).

Ответ: с ack — `{ ok: true, data? }` или `{ ok: false, error: { code, message, details? } }`
(`TSocketAck`, `ISocketAckError` в `socket.types.ts`); без ack — событие
`error { event, code, message }`.

Лимиты задают модули рядом с хендлером (`<FEATURE>_SOCKET_LIMITS`). Лимит — на сокет, не на пользователя: несколько вкладок имеют
отдельные вёдра; общий лимит пользователя потребовал бы Redis.

### Интерфейсы расширения

- **ISocketHandler** — обрабатывает входящие socket-события (через `onValidated`). Регистрация через `asSocketHandler()`. Сейчас ни один модуль handler не регистрирует: клиент шлёт только события соединения (`ping`, `auth:refresh`, `room:subscribe/unsubscribe`).
- **ISocketEventListener** — слушает EventBus и транслирует в socket. Регистрация через `asSocketListener()`.

## Типы событий

`socket.types.ts` объявляет только события соединения:

- клиент → сервер (`ISocketEvents`): `ping`, `auth:refresh`, `room:subscribe`, `room:unsubscribe`;
- сервер → клиент (`ISocketEmitEvents`): `pong`, `authenticated`, `auth_error`, `auth:expired`, `error`.

События модулей объявлены в их `<feature>.socket-events.ts` дополнением интерфейсов:

```ts
import type { PublicProfileDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    "profile:updated": (...args: [PublicProfileDto]) => void;
  }
}
```

`declare module` указывает на `../socket/socket.types`, а не на `../socket`: дополнить
можно только модуль, объявивший интерфейс. Эмиттер и `onValidated` видят события
всех подключённых модулей; удалённый модуль уносит свои события с собой.

## Зависимости

| Зависимость    | Откуда   | Использование                 |
| -------------- | -------- | ----------------------------- |
| `socket.io`    | npm      | WebSocket-сервер              |
| `HttpServer`   | `core`   | HTTP-сервер для Socket.IO     |
| `TokenService` | `core`   | JWT-верификация               |
| `EventBus`     | `core`   | Очистка подписок при shutdown |
| `config.cors`  | `config` | CORS-настройки                |

## Взаимодействие

Listeners регистрируют auth, user, profile, session, audit, jobs, wg-node,
wg-interface, wg-peer, wg-stats; политики комнат — jobs (`job`) и модули wg-*
(см. их README). Room provider-ов нет.

Модули регистрируют свои handlers и listeners через `SOCKET_HANDLER` и `SOCKET_EVENT_LISTENER` (`asSocketHandler`, `asSocketListener`), комнаты — через `asSocketRoomProvider` / `asSocketRoomPolicy`. SocketBootstrap собирает их через `@multiInject` и активирует при старте.
