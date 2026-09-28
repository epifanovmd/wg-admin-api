# Модуль wg-node

Корень WG-домена: ноды (VPS с агентом), команды агентам, общие сервисы домена
(шифрование секретов, генерация ключей WireGuard, проверка прав по userId,
конфигурация `wg.config.ts`).

## Модель

- **WgNode** (`wg_nodes`) — VPS с установленным агентом. Желаемая конфигурация
  версионируется: `configVersion` растёт при любом изменении домена
  (`WgNodeService.markDirty`, вызывается в транзакции изменения), агент
  применяет её и сообщает `appliedVersion`/`applyError`. `status`:
  `created | provisioning | online | offline | error` — живость агента
  (`lastSeenAt`, cron `wg.node-offline`). Ключ агента — api-key со scope
  `wg-agent:<nodeId>` (`agentKeyId`), выдаётся при создании ноды и при ротации,
  секрет возвращается один раз.
- **WgNodeCommand** (`wg_node_commands`) — императивные команды агенту из
  фиксированного набора: `interface-restart`, `agent-logs`, `agent-update`.
  Статусы
  `pending → running → succeeded | failed | timeout`; вывод копится в `output`
  (предел `WG_COMMAND_OUTPUT_MAX_BYTES`). Агент берёт и завершает только
  команды своей ноды.

## Эндпоинты (`/api/v1/wg/nodes`, тег WgNode)

| Метод  | Путь                     | Право                                                   |
| ------ | ------------------------ | ------------------------------------------------------- |
| POST   | `/`                      | `wg:node:create` (ответ содержит `agentKey` — один раз) |
| GET    | `/`, `/options`, `/{id}` | `wg:node:view`                                          |
| PATCH  | `/{id}`                  | `wg:node:update`                                        |
| DELETE | `/{id}`                  | `wg:node:delete` (при интерфейсах — 409)                |
| POST   | `/{id}/agent-key`        | `wg:node:agent` — ротация ключа агента                  |
| GET    | `/{id}/logs`             | `wg:node:logs` — журнал агента (синхронно)              |

`wg:node:agent` также даёт обновление агента (модуль wg-agent), `wg:node:provision` —
установку и удаление агента по SSH (модуль wg-provision).

## Сокет

Комната `wg-node_<id>` (policy `wg-node`, право `wg:node:view` — по актуальным правам из БД через
`AccessService` ядра). События:
`wg:node:updated` (в комнату ноды и `wg-overview`).

## Общие сервисы домена

- `WgSecretBox` — AES-256-GCM для приватных ключей/PSK/SSH-ключей в БД
  (ключ `WG_SECRETS_KEY`, в dev/test — производный).
- `wg-keys.ts` — генерация ключей WireGuard (X25519 через `node:crypto`,
  без вызова `wg`), PSK.
- `validation/wg-shared.validate.ts` — общие Zod-схемы домена (хосты, CIDR,
  AllowedIPs, DNS) — всё, что попадает в конфиги, валидируется строго.

## Конфигурация (`wg.config.ts`, секция `wg`)

`WG_SECRETS_KEY` (обязателен в production), `WG_AGENT_POLL_WAIT_MS`,
`WG_AGENT_OFFLINE_AFTER_SEC`, `WG_COMMAND_TIMEOUT_SEC`, `WG_COMMAND_*`,
`WG_STATS_*_RETENTION_*`, `WG_NODE_METRIC_RETENTION_DAYS`.
