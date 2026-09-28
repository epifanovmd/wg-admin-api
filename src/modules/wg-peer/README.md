# Модуль wg-peer

Пиры WireGuard-интерфейсов: ключи и IP выделяются сервером, приватный ключ и
PSK хранятся зашифрованными (перевыпуск конфига/QR в любой момент); пир можно
создать импортом публичного ключа — тогда приватный ключ не хранится вовсе.

## Доступ

- `wg:peer:view` — все пиры и их конфиги; `wg:peer:own` — базовое право
  пользователя VPN: свои пиры, их конфиги/QR и включение-выключение. Без view
  список автоматически ограничивается своими пирами; чужой пир по id — 404.
- `wg:peer:create` / `wg:peer:update` / `wg:peer:delete` — CRUD;
  `wg:peer:toggle` — включение-выключение любых пиров; `wg:peer:psk` — ротация и
  удаление PSK; `wg:peer:assign` — назначение и снятие владельца.

## Модель

**WgPeer** (`wg_peers`): interfaceId (FK RESTRICT), userId (SET NULL),
name/publicKey/addressV4 — unique на интерфейсе; addressV6 — производный от
IPv4-смещения; clientAllowedIPs/clientDns/clientMtu/keepalive — параметры
клиентского конфига; enabled + disabledReason (`manual|expired`), expiresAt;
lastHandshakeAt/lastEndpoint/rxBytesTotal/txBytesTotal обновляет статистика.
`isOnline` — handshake свежее 180 с.

## Эндпоинты (`/api/v1/wg/peers`, тег WgPeer)

CRUD + options + `{id}/enable|disable` (владелец — тоже), `{id}/psk/rotate`,
`DELETE {id}/psk`, `{id}/assign|revoke`, `GET {id}/config` (text/plain,
attachment), `GET {id}/qr` (PNG data-URL). Конфликты имени/ключа/адреса — 409,
исчерпание подсети — 409 `WG_PEER_SUBNET_FULL`.

## Хелперы

- `wg-ip-allocator.ts` — первый свободный IPv4 подсети + производный IPv6.
- `wg-client-config.ts` — сборка клиентского конфига (все поля валидированы
  Zod-схемами — инъекция строк в конфиг невозможна) и имя файла.
- `serverPeers(interfaceIds)` — пиры для серверных конфигов (desired state).
- `applyStatsUpdates` — вызывает модуль wg-stats; `disableExpired` — задача
  `peer-expiry.job.ts` этого модуля.

## Сокет

Комната `wg-peer_<id>` (policy `wg-peer`: view или свой пир), комната «мои
пиры» `wg-peers-own_<userId>` (policy `wg-peers-own`: только своя, право
`wg:peer:own`) — live-статистика пиров держателя; события
`wg:peer:updated`/`wg:peer:deleted` (комната, overview, держателю).
