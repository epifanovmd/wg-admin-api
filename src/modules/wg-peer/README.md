# Модуль wg-peer

Пиры WireGuard-интерфейсов: ключи и IP выделяются сервером, приватный ключ и
PSK хранятся зашифрованными (перевыпуск конфига/QR в любой момент); пир можно
создать импортом публичного ключа — тогда приватный ключ не хранится вовсе.

## Доступ

Действия над пиром — с областью (`scoped`): право на все пиры или `…:own` —
только на свои. Свой пир — где пользователь держатель (`userId`) или создатель
(`createdById`); проверки — `WgPeerAccess` (`OwnedAccess` ядра).

- `wg:peer:view[:own]` — просмотр, конфиг и QR. С `:own` списки ограничиваются
  своими пирами; невидимый пир по id — 404, видимый без права на действие — 403.
- `wg:peer:update|delete|toggle|psk|assign[:own]` — изменение, удаление,
  включение-выключение, ротация и удаление PSK, назначение и снятие держателя.
- `wg:peer:create` — создание (без области); создатель — автор запроса. Держатель
  при создании, отличный от себя, — только с правом назначения. Интерфейс пира
  должен быть виден автору (`wg:interface:view[:own]`), иначе 404
  `WG_IFACE_NOT_FOUND`.
- Роль `user` засевается с `wg:peer:view:own` и `wg:peer:toggle:own`.

## Модель

**WgPeer** (`wg_peers`): interfaceId (FK RESTRICT), userId — держатель и
createdById — создатель (оба SET NULL),
name/publicKey/addressV4 — unique на интерфейсе; addressV6 — производный от
IPv4-смещения; clientAllowedIPs/clientDns/clientMtu/keepalive — параметры
клиентского конфига; enabled + disabledReason (`manual|expired`), expiresAt;
lastHandshakeAt/lastEndpoint/rxBytesTotal/txBytesTotal обновляет статистика.
`isOnline` — handshake свежее 180 с.

## Эндпоинты (`/api/v1/wg/peers`, тег WgPeer)

CRUD + options + `{id}/enable|disable`, `{id}/psk/rotate`,
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

Комнаты:

- `wg-peers` — список пиров (`permissionRoomPolicy`, `wg:peer:view`);
- `wg-peer_<id>` — карточка пира (policy `wg-peer`: право на все или свой пир);
- `wg-peers-own_<userId>` — «мои пиры» (policy `wg-peers-own`: только своя, любая
  область `wg:peer:view`) — live-статистика своих пиров (модуль wg-stats).

`WgPeerListener` (в `wg-overview` не шлёт):

| Событие                                    | Сокет                   | Куда                                                              |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------- |
| `WgPeerCreatedEvent`, `WgPeerUpdatedEvent` | `wg:peer:updated` (DTO) | `wg-peers`, `wg-peer_<id>`, своим (`OwnedEntityEmitter.toOwners`) |
| `WgPeerUpdatedEvent` с `previousUserId`    | `wg:peer:deleted {id}`  | прежнему держателю, если он не создатель (`detach`)               |
| `WgPeerDeletedEvent`                       | `wg:peer:deleted {id}`  | `wg-peers`, `wg-peer_<id>`, своим                                 |

«Своим» — держателю и создателю с областью `own` права просмотра; с правом на
все события приходят через комнату списка.

`WgPeerUpdatedEvent(peer, previousUserId)`: `assign`/`revoke` передают прежнего
держателя, если он сменился (иначе `null`); прежний держатель убирает пир из своих
списков и теряет подписку на комнату пира (`room:revoked`).
