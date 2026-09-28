# app-info

Сведения о запущенном бэкенде. Сущностей и событий нет.

## Эндпоинты

- `GET /api/v1/app/version` — любой вошедший пользователь (`jwt`):
  `{ version, commit, builtAt, startedAt, agentVersion }`. `agentVersion` —
  версия агента, которую бэкенд ставит и раздаёт (`WgAgentBinaryService`,
  `agent/dist/VERSION`); null — бинари не собраны. Установленная на ноде —
  `agentVersion` ноды.

## Откуда версия

`config.app` из окружения образа: `APP_VERSION` (`git describe --tags
--always --dirty`: тег или SHA), `APP_COMMIT` (короткий SHA),
`APP_BUILT_AT` (ISO 8601). Их передаёт сборка: `make` (deploy, image,
local-up) и `release.yml` — build-args последнего слоя `Dockerfile`. Вне
образа (`yarn dev`) — версия из `package.json`, `commit` и `builtAt` — null.
`startedAt` — время запуска процесса.
