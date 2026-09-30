# Модуль wg-socks

SOCKS5-прокси через mTLS на нодах: агент ноды
принимает TLS только с клиентским сертификатом, выданным CA сервиса и не
отозванным, затем SOCKS5 с логином и паролем (RFC 1929) и CONNECT.

## Доступ

Действия над прокси — с областью (`scoped`): право на все прокси или `…:own` —
только на свои. Свой прокси — где пользователь назначенный владелец
(`ownerId`) или создатель (`createdById`); проверки — `WgSocksAccess`
(`OwnedAccess` ядра) и `findSocksFor` (`wg-socks.lookup.ts`, общий для
сервиса и клиента устройства). Невидимый прокси по id — 404, видимый без права
на действие — 403 `WG_SOCKS_FORBIDDEN`; список ограничен областью
`wg:socks:view`.

- `wg:socks:create` — без области; создатель — автор запроса, владелец
  (`ownerId`), отличный от себя, — только с правом назначения (несуществующий
  пользователь — 404 `WG_SOCKS_OWNER_NOT_FOUND`). Нода прокси должна быть видна
  автору (`wg:node:view[:own]`), иначе 404 `WG_NODE_NOT_FOUND`.
- `agentConfigs`, `recordStats` — внутренние (агент), без проверки прав.

## Модель

**WgSocksService** (`wg_socks_services`): ownerId (владелец), createdById
(создатель; оба FK users SET NULL), name (unique), nodeId (FK RESTRICT),
listenPort (unique на ноде), clientHost/clientPort — адрес для клиентов, если
прокси доступен через TCP-проброс на другой ноде (null — publicHost ноды и
listenPort), serverName — имя из серверного сертификата, CA (сертификат и
ключ), серверный сертификат и ключ, enabled. Вся PKI выпускается сервисом при
создании прокси. Ключи зашифрованы `WgSecretBox`.

**WgSocksUser** (`wg_socks_users`): username (unique в сервисе), пароль —
зашифрованный (показать админу) и scrypt-хэш с солью (агенту уходит только
хэш), enabled.

**WgSocksClient** (`wg_socks_clients`): сертификат устройства, его ключ
(для клиента устройства), SHA-256 отпечаток (allowlist агента), revoked.

PKI — `wg-socks-pki.ts` (ECDSA P-256): новый CA и сертификаты, отпечаток,
проверка имени сервера в сертификате.

## Агент

Desired state ноды — `socks[]`: порт, серверный сертификат/ключ, CA, отпечатки
неотозванных клиентов, включённые пользователи (соль и хэш). Любое изменение
поднимает версию ноды в транзакции. Агент меняет сертификаты без перезапуска
слушателя и сразу рвёт соединения отозванных клиентов и выключенных
пользователей. Статистика агента (`socks`: соединения и байты) — в
live-хранилище (TTL 60 с), поле `live` DTO.

Порт прокси заявлен через `asWgRelayConsumer` (`claimedPorts`): проброс на тот
же TCP-порт ноды — 409 `WG_FORWARD_PORT_TAKEN`; прокси на порт проброса —
409 `WG_SOCKS_PORT_TAKEN`.

Сервисы: `WgSocksAppService` — прокси, пользователи, сертификаты, конфигурация
агента и статистика; `WgSocksClientKitService` — клиент для устройства.

## Эндпоинты (`/api/v1/wg/socks`, тег WgSocks)

Чтение — `wg:socks:view[:own]`. Все права, кроме создания, — с областью `[:own]`.

- CRUD сервиса — `wg:socks:create`, `wg:socks:update` (изменение и включение),
  `wg:socks:delete`; `POST /{id}/assign` `{ userId }` / `POST /{id}/revoke` —
  владелец, `wg:socks:assign`.
- `/{id}/users` — добавление (пароль генерируется, если не задан), изменение,
  удаление — `wg:socks:users`; `GET …/secret` — логин и пароль,
  `wg:socks:secrets`.
- `/{id}/clients` (`wg:socks:clients`) — выпуск, `POST …/revoke`, `GET …/mac?userId=` — zip для
  macOS: `install.sh` (stunnel из Homebrew, автозапуск launchd, локальный
  SOCKS5 127.0.0.1:1080), `uninstall.sh`, README с настройками и ссылкой для
  Telegram.

## Сокет

Комната `wg-socks` (право `wg:socks:view` — на все прокси): `wg:socks:updated`
(сервис, пользователи, сертификаты), `wg:socks:deleted`, `wg:socks:stats { id,
live }` (только при изменении соединений или трафика). Те же события — своим
(владельцу и создателю с областью `own`, `OwnedEntityEmitter.toOwners`;
владелец и создатель есть в `WgSocksStatsEvent`); при смене владельца
(`WgSocksUpdatedEvent.previousOwnerId`) прежний, если он не создатель, получает
`wg:socks:deleted` (`detach`). Комнаты отдельного прокси нет.
