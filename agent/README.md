# Папка агента

Всё, что агент делает на машине разработчика и на узлах, — здесь: программа агента, её
настройки и воркеры проекта `wg` и `socks`. Сам агент — отдельный проект
([github.com/epifanovmd/agent](https://github.com/epifanovmd/agent), версия 1.x); здесь — то,
что запускает на нём этот бэкенд.

```
agent/
├── agent               программа агента (не в git: yarn agent скачивает её сам, yarn agent upgrade обновляет)
├── agent.yaml          машина разработчика — yarn agent (воркер wg — в имитации)
├── agent.prod.yaml     узлы WireGuard: поверх agent.yaml (экземпляр wg, root, пакеты, sysctl)
├── .env.prod.example   образец .env.prod — если узел ставится не с API
├── workers/wg/         воркер wg (Go): интерфейсы, туннели, пробросы, пробы
├── workers/socks/      воркер socks (Go): SOCKS5-прокси через mTLS
├── internal/, go.mod   общий Go-код воркеров
├── go-worker.sh        сборка Go-воркера: Go на машине, иначе в контейнере (scripts/go-agent.sh)
├── dev.mjs             yarn agent*: программа агента, порт и токен API из .env.development
├── bundle/             архивы для узлов (yarn agent:pack, не в git) — их раздаёт API
└── dist/               сборки агента для сквозных тестов (yarn agent:fetch) и воркеров (go-agent.sh build), не в git
```

## Кто есть кто

- **Агент** — одна программа на узле. Держит связь с бэкендом, хранит настройки, присылает
  метрики узла (процессор, память, диск, сеть), пишет журнал, обновляет себя и воркеры. Своей
  предметной области у агента нет: всё, что касается WireGuard, делают воркеры.
- **Воркер** — небольшая программа на Go, которую агент запускает и с которой говорит по HTTP
  через unix-сокет. Воркеры проекта — папки в `workers/`: исходники, `VERSION` и два
  исполняемых файла — `build` (сборка для архива узла) и `run` (запуск из исходников).
- **Настройки** — `agent.yaml` и файлы поверх него (`extends`): что запускать и как. Итог и
  откуда каждое значение — `yarn agent config check` (или `--env prod`).

```
бэкенд ──WebSocket──► агент ──HTTP по unix-сокету──► воркер wg     (интерфейсы, туннели, пробросы)
                                                 └──► воркер socks  (SOCKS5-прокси через mTLS)
```

- **wg** — интерфейсы WireGuard с пирами, IPIP-туннели между узлами, пробросы портов и выбор
  маршрута по пробам, проверка связности с другими узлами.
- **socks** — SOCKS5-прокси: вход только с клиентским сертификатом из разрешённого списка, затем
  логин и пароль.

Бэкенд передаёт воркеру **настройку** (ключ и значение JSON): агент сохраняет её у себя и
вызывает `PUT /config/<ключ>`. Ответ воркера — итог применения — агент возвращает бэкенду.
После перезапуска агент сам передаёт воркерам последние сохранённые настройки: узел работает и
без связи с бэкендом. Формат связи агента и воркеров — в
[спецификации агента](https://github.com/epifanovmd/agent/blob/main/sdk/spec/README.md)
(настройки, самочувствие и метрики, воркер и манифест, жизнь воркера). Со стороны бэкенда
значения настроек, итоги, метрики и события воркеров описаны в
`src/modules/wg-agent/wg-worker.contract.ts` — его меняют вместе с воркерами.

## Агент на своей машине

```bash
yarn dev                          # API (в .env.development — AGENT_BOOTSTRAP_TOKEN)
yarn agent                        # агент с воркерами wg и socks (agent.yaml); Ctrl+C — остановка
yarn agent:start | agent:stop [--force] | agent:status | agent:logs   # то же в фоне
yarn agent config check           # итоговые настройки и откуда каждое значение
yarn agent worker list            # воркеры: откуда каждый, версия
yarn agent upgrade --check        # есть ли новая версия агента (yarn agent upgrade — поставить)
```

`yarn agent` (это `agent/dev.mjs`) скачивает программу агента той же версии, что `agent-sdk` в
`package.json`, если её ещё нет (со сверкой sha256), берёт `SERVER_PORT` и
`AGENT_BOOTSTRAP_TOKEN` из `.env.development` (другой файл — `ENV_FILE=…`) и запускает
`agent/agent run`. Токен — тот же, что у API, не короче 32 символов.

- Воркеры идут прямо из исходников: `run` в папке воркера собирает его под эту машину в `.bin/`
  и запускает (`go-worker.sh run`). Go нет — сборка в контейнере `golang`
  (`scripts/go-agent.sh`), нужен Docker. Правки видны после перезапуска воркера.
- Воркер wg — в имитации (`WG_DRY_RUN=1` в `agent.yaml`): системные команды не выполняются,
  конфиги и `state.json` — в `.agent/data/wg/`.
- Имя агента — `AGENT_NAME` (по умолчанию `dev-$USER`), привязать к ноде — `AGENT_NODE_ID=<id>`
  (метка `nodeId`). Данные агента — `.agent/data`: удалить — агент зарегистрируется заново и
  привяжется к ноде по метке или имени. Второй агент — `AGENT_DIR=.agent-2 AGENT_NAME=dev-2 yarn agent`.
- Здесь агент не обновляет себя по команде сервера (`update: disabled`): новую версию ставит
  `yarn agent upgrade`.

## Воркер wg

Окружение (агент задаёт сам `AGENT_WORKER_SOCKET`, `AGENT_SOCKET`, `AGENT_WORKER_TOKEN`):

| Переменная      | По умолчанию        | Что                                                                                                          |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `WG_CONFIG_DIR` | `/etc/wireguard`    | конфиги wg-quick; на Ubuntu AppArmor разрешает wg-quick читать только этот каталог                           |
| `WG_STATE_DIR`  | `/var/lib/wg-admin` | `state.json` — что создал воркер: его интерфейсы и туннели                                                   |
| `WG_DRY_RUN`    | —                   | `1` — имитация без системных команд (ниже); каталоги по умолчанию — `$TMPDIR/wg-admin-dry/{wireguard,state}` |

### Настройка `state` — желаемое состояние узла

```jsonc
{
  "version": 42, // версия конфигурации ноды на бэкенде
  "nodeId": "…",
  "nodeName": "relay-1",
  "interfaces": [
    {
      "name": "wg0",
      "enabled": true,
      "listenPort": 51820,
      "addressCidr": "10.0.0.1/24",
      "addressV6Cidr": null,
      "privateKey": "…",
      "mtu": null,
      "natEnabled": true,
      "customPostUp": null,
      "customPostDown": null,
      "peers": [
        { "publicKey": "…", "presharedKey": null, "allowedIps": "10.0.0.2/32" },
      ],
    },
  ],
  "tunnels": [
    {
      "name": "wgt1",
      "remoteHost": "203.0.113.20",
      "localTunnelIp": "10.99.0.1",
      "remoteTunnelIp": "10.99.0.2",
      "prefix": 30,
      "mtu": 1480,
    },
  ],
  "forwards": [
    {
      "id": "f1",
      "proto": "udp",
      "listenPort": 51820,
      "targetIp": "10.99.0.2",
      "targetPort": 51820,
      "fallbackIp": "203.0.113.20",
      "route": "auto",
      "tunnel": "wgt1",
      "candidates": [
        { "targetIp": "10.99.0.2", "tunnel": "wgt1", "nodeId": "…" },
      ],
    },
  ],
}
```

Ответ `PUT /config/state` — **итог применения** (`200`; агент передаёт его бэкенду в
`config.applied.result`):

```jsonc
{
  "version": 42,
  "appliedAt": 1791548441645,
  "interfaces": [{ "name": "wg0", "status": "up" }], // up | down | error (+ message)
  "routes": [
    {
      "id": "f1",
      "activeRoute": "tunnel",
      "activeCandidate": 0,
      "activeNodeId": "…",
    },
  ],
  "errors": [], // ошибки отдельных частей: применение остального они не останавливают
}
```

- Неверный JSON или нет `data` — `400 { message }`; имя интерфейса или туннеля, протокол или
  порт, которые нельзя подставить в команды, — `422 { message }`. Агент сообщит бэкенду
  `CONFIG_REJECTED` с этим текстом.
- Применение не успело за 25 с (срок агента — 30 с) — ответ `202` с пустым итогом той же
  версии; настоящий итог воркер пришлёт событием `state.result`, когда применение закончится.
- Применения идут строго по одному.

Как применяется — **по разнице**, без лишних разрывов:

- конфиг интерфейса пишется атомарно (0600); изменилась секция `[Interface]` — `wg-quick down`
  и `up`; изменились только пиры — `wg syncconf` (соединения не рвутся); интерфейс пропал из
  настройки — `down` и удаление конфига; `enabled: false` — `down`;
- `natEnabled` — masquerade через интерфейс маршрута по умолчанию в PostUp и PostDown;
- IPIP-туннели (`ip tunnel`, rp_filter=0): совпадающий поднятый туннель не пересоздаётся;
- пробросы — в своих цепочках iptables `WG_ADMIN_PRE`, `WG_ADMIN_POST` и `WG_ADMIN_FWD`
  (переход в FORWARD — первым правилом: на узлах с Docker политика FORWARD — DROP). Цепочки
  пересобираются целиком, чужие правила не трогаются. Сменилась цель проброса — потоки этого
  порта сбрасываются (`conntrack -D`), иначе клиент остался бы на прежней цели.

**Защита от чужого.** Воркер трогает только то, что создал сам (`state.json`):

- конфиг `<имя>.conf` уже есть в `WG_CONFIG_DIR`, создан не воркером и отличается — не
  перезаписывается: у интерфейса `status: error`, «чужой конфиг» (совпадающий конфиг воркер
  принимает как свой); интерфейс с таким именем уже поднят без конфига — тоже ошибка;
- туннель не поднимается, если его подсеть пересекается с адресом другого интерфейса или к тому
  же узлу уже есть чужой IPIP-туннель; проброс не ставится на порт, который слушает другой процесс.

**Повтор.** Пока в итоге есть ошибки, воркер раз в 25 с применяет текущее состояние снова
(порт мог освободиться). Итог изменился — событие `state.result`.

**Пробы и выбор маршрута.** Раз в ~10 с — ping через каждый туннель (и пакет размером MTU с
запретом фрагментации) и до прямых адресов кандидатов. Проброс `auto` уходит с туннеля на
прямой адрес после 3 неудачных проб подряд и возвращается после первой удачной; у пробросов с
`candidates` берётся первый живой кандидат. Маршрут сменился — воркер применяет состояние заново
и шлёт события `route.changed` `{ version, routes }` и `state.result`.

### Настройка `probes` — проверка связности с другими узлами

`{ "targets": [{ "nodeId": "…", "host": "203.0.113.9" }] }` → `200 { count }`. Раз в ~60 с (и
сразу после настройки) — 10 ping до каждого узла; итог — в метриках `nodeProbes`.

### Маршруты, метрики, самочувствие

| Запрос                            | Ответ                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /interfaces/{name}/restart` | `wg-quick down` и `up` → `200 { name, status: "up" }`; нет в настройке — 404, выключен — 409, ошибка — 500 `{ message }` |
| `GET /state`                      | последний итог применения; ещё не было — 404 `{ message }`                                                               |
| `DELETE /config/state`            | снять всё своё (как пустая настройка) → 204                                                                              |
| `DELETE /config/probes`           | цели проб пусты → 204                                                                                                    |
| `POST /cleanup`                   | убрать всё созданное воркером (ниже) → 204                                                                               |

Бэкенд может вызывать только маршруты из манифеста (`GET /manifest`): перезапуск интерфейса и
`GET /state`. Остальное вызывает сам агент.

`GET /metrics` (агент спрашивает с частотой метрик; ответ — последние значения, пробы идут в
фоне):

```jsonc
{
  "interfaces": [
    {
      "name": "wg0",
      "peers": [
        {
          "publicKey": "…",
          "rxBytes": 1,
          "txBytes": 2,
          "lastHandshake": 1791548441,
          "endpoint": "198.51.100.7:53211",
        },
      ],
    },
  ], // wg show all dump
  "tunnels": [
    { "name": "wgt1", "rttMs": 41.2, "lossPercent": 0, "mtuOk": true },
  ],
  "forwards": [
    {
      "id": "f1",
      "activeRoute": "tunnel",
      "activeCandidate": 0,
      "activeNodeId": "…",
    },
  ],
  "nodeProbes": [{ "nodeId": "…", "rttMs": 12.5, "lossPercent": 0 }],
}
```

`GET /health` (раз в 5 с): `{ ok, message?, info: { version, dryRun, wgVersion, wgMode, distro,
kernel, udpPorts, tcpPorts, stateVersion, interfaces, errors } }`. `ok: false` — только если
воркер не может работать вообще (нет `wg`, `wg-quick` или `ip`; не Linux без имитации). Ошибки
применения — в `info.errors` и `message`, `ok` они не роняют: иначе агент откатил бы обновление
воркера.

**Остановка и уборка.** SIGTERM (перезапуск или обновление воркера, остановка агента) — воркер
закрывает HTTP и выходит, **ничего не разбирая**: VPN и пробросы продолжают работать, новый
процесс застаёт их на месте. `POST /cleanup` (его вызывает `agent uninstall`) — `wg-quick down`
интерфейсов воркера, удаление его туннелей `wgt*`, цепочек `WG_ADMIN_*` и переходов на них,
конфигов воркера и `state.json`; до новой настройки воркер ничего не применяет.

### Имитация (`WG_DRY_RUN=1`)

Для разработки на macOS и проверки связки с бэкендом: ни одной системной команды. Конфиги
интерфейсов для наглядности пишутся в `WG_CONFIG_DIR`, `state.json` — в `WG_STATE_DIR` (по
умолчанию — `$TMPDIR/wg-admin-dry`; у `yarn agent` — `.agent/data/wg/{wireguard,state}`, так
задано в `agent.yaml`). Включённые интерфейсы — `up`, выключенные — `down`,
туннели и пробросы принимаются, маршрут — первый кандидат. Метрики синтетические: счётчики пиров
растут со временем, рукопожатие — только что, адрес пира — `203.0.113.<n>:51820`; пробы туннелей
и узлов — 1–5 мс без потерь. В самочувствии — `dryRun: true`, `wgVersion: "dry-run"`,
`wgMode: "userspace"`. Защита от чужого конфига работает и здесь.

## Воркер socks

Настройка `proxies`:

```jsonc
{
  "proxies": [
    {
      "id": "…",
      "listenPort": 1080,
      "certPem": "…",
      "keyPem": "…",
      "caPem": "…",
      "allowedFingerprints": ["<sha256 сертификата клиента, hex>"],
      "users": [{ "username": "…", "salt": "<hex>", "hash": "<scrypt, hex>" }],
    },
  ],
}
```

Ответ — `200 { version, proxies: [{ id, listenPort, status: "listening" | "error", message? }],
errors }`. Новые прокси начинают слушать, удалённые и сменившие порт закрываются; новые
сертификаты действуют без перезапуска слушателя; отзыв сертификата или пользователя сразу рвёт
его соединения. Прокси с ошибкой (порт занят) воркер повторяет раз в 25 с.
`DELETE /config/proxies` и `POST /cleanup` закрывают все прокси.

- `GET /metrics` → `{ proxies: [{ id, connections, rxBytes, txBytes }] }`;
- `GET /health` → `{ ok: true, info: { version, proxies: [{ id, listenPort, status, message? }] } }`;
- `GET /proxies` (маршрут манифеста) — статусы последнего применения.

Прокси живут в процессе воркера: SIGTERM закрывает их. Работает на любой ОС, имитации нет.

## Воркеры: сборка и версии

У каждого воркера в папке два исполняемых файла, оба вызывают `agent/go-worker.sh`:

| Файл    | Кто вызывает                       | Что делает                                                                              |
| ------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `build` | `agent pack`                       | программа воркера под платформу узла (`GOOS`, `GOARCH`, `OUT` задаёт pack) → `$OUT/run` |
| `run`   | `agent run` на машине разработчика | сборка под эту машину в `.bin/` и запуск; на узле `run` — сама программа из архива      |

Go на машине не обязателен: без него `go-worker.sh` собирает в контейнере `golang` версии
toolchain из `go.mod` (`scripts/go-agent.sh`).

- **Версия** — файл `VERSION` воркера (вшивается в программу, `-X main.version`). Изменили код
  воркера — поднимите его `VERSION` (общий код `internal/`, `go.mod`, `go.sum` — оба воркера):
  `scripts/check-agent-version.sh` в CI сверяет это с последним тегом `v*`. Разные сборки под
  одной версией агент не различит.
- **Обновить воркер на узлах** — поднять `VERSION`, новый образ API (или `yarn agent:pack`) и
  `POST /api/v1/wg/nodes/{id}/workers/<имя>/update` (кнопка на странице ноды).

## Как агент попадает на узел

Принцип один — вручную и с API: архив папки агента под машину узла и `agent install` из него.

```bash
yarn agent:pack                   # agent/bundle: agent-prod-<версия>-linux-{amd64,arm64}.tar.gz и release/
```

`agent pack --env prod` кладёт в архив программу агента под платформу узла, `agent.yaml` +
`agent.prod.yaml`, воркеры `wg` и `socks`, собранные под эту платформу (их `build`), и их
подписанные сборки (`release/`) — для обновления воркеров с API. `agent install` на узле ставит
агента службой по `install:` из `agent.prod.yaml`:

- экземпляр `wg` — своя служба `agent-wg` и свои каталоги рядом с агентами других бэкендов;
- `privileged: true` — агент и воркеры от root без ограничений systemd: воркер wg настраивает
  сеть, iptables и пишет в `/etc/wireguard`;
- пакеты `wireguard-tools iproute2 iptables conntrack iputils-ping` (имена для apt;
  `packagesByManager` — для dnf, yum, apk, zypper, где пакеты называются иначе);
- `sysctl`: `net.ipv4.ip_forward=1`, `net.ipv6.conf.all.forwarding=1`;
- воркер wg — на настоящей системе (`WG_DRY_RUN=0`, `/etc/wireguard`, `/var/lib/wg-admin`).

Адрес API и токен регистрации передаёт установка. Узел — Linux с systemd (Alpine без systemd
не поддерживается); ядро без модуля WireGuard (старше 5.6) — поставьте `wireguard-go`, wg-quick
сам возьмёт его.

| Как                  | Что сделать                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| вручную, архивом     | `scp agent/bundle/agent-prod-…-linux-amd64.tar.gz узел:` → `tar xzf … && cd agent && sudo ./agent install --server https://<api> --token <токен>` |
| одной командой с API | токен и команда — при создании ноды или `POST /api/v1/wg/nodes/{id}/install-command` (общая — `POST /api/v1/agent-releases/install-command`)      |
| с API по SSH         | `POST /api/v1/wg/nodes/{id}/provision` — то же самое на узле, токен — файлом                                                                      |
| удалить              | `sudo /opt/agent-wg/bin/agent uninstall --instance wg [--purge]` или `POST /api/v1/wg/nodes/{id}/uninstall`                                       |

Команда установки с API:

```bash
curl -fsSL 'https://<api>/api/v1/agent-bundle/install.sh' | sudo sh -s -- --token '<токен>' --name '<нода>'
```

Флагов экземпляра, воркеров, пакетов и прав в ней нет — всё это в `agent.prod.yaml` архива.
`POST /api/v1/agent-releases/install-command` принимает `{ token | tokenFile, baseUrl?, name? }`.
API раздаёт архивы из `AGENT_BUNDLE_DIR` (`/api/v1/agent-bundle/install.sh` и
`/api/v1/agent-bundle/linux-<arch>.tar.gz`, без входа: секретов в архиве нет); в образе API
(`/app/agent/bundle`) их собирает стадия `agent-bundle` `Dockerfile` (`agent pack --env prod`
для linux/amd64 и linux/arm64), для разработки — `yarn agent:pack` (`AGENT_BUNDLE_DIR=agent/bundle`).
Узел ставится не с API — адрес и токен можно положить в `agent/.env.prod` (образец —
`.env.prod.example`) до `yarn agent:pack`.

На узле (экземпляр `wg`):

| Что               | Где                                                   |
| ----------------- | ----------------------------------------------------- |
| программа         | `/opt/agent-wg/bin/agent` (ссылка — `agent-wg`)       |
| настройки и токен | `/etc/agent-wg/agent.yaml`, `/etc/agent-wg/agent.env` |
| данные и воркеры  | `/var/lib/agent-wg`                                   |
| служба            | `agent-wg` (`systemctl status agent-wg`)              |

```bash
sudo agent-wg status          # связь, воркеры, последняя ошибка
sudo agent-wg logs -f         # журнал агента и воркеров (journalctl -u agent-wg)
sudo agent-wg upgrade         # новая версия агента
sudo systemctl reload agent-wg                               # перечитать настройки
sudo wg show                                                 # интерфейсы WireGuard
sudo /opt/agent-wg/bin/agent uninstall --instance wg         # удалить: воркеры убирают за собой (POST /cleanup)
sudo /opt/agent-wg/bin/agent uninstall --instance wg --purge # и настройки, данные, поставленные установкой пакеты
```

## Обновления и подписи

- **Агента** бэкенд берёт из релизов GitHub `epifanovmd/agent` сам (`AGENT_RELEASES_*`,
  диапазон `^1`): проверяет при запуске и раз в час (`AGENT_RELEASES_CHECK_INTERVAL_MS`), новую
  версию пишет в журнал и сообщает админке сокетом. Агент на узле тоже сам проверяет новые
  версии (`update: self`) и сообщает о них. Обновить — из админки
  (`POST /api/v1/wg/nodes/{id}/agent/update`) или `sudo agent-wg upgrade` на узле. Пересобирать
  бэкенд ради новой версии агента не нужно. Узлам без доступа к GitHub —
  `AGENT_RELEASES_PROXY=true` (бэкенд передаёт файл сам), своё зеркало или закреплённая версия —
  `AGENT_RELEASES_URL`.
- **Воркеры проекта** подписывает `agent pack` ключом проекта из `AGENT_SIGNING_KEY` (пара —
  `yarn agent keygen`). Открытый ключ попадает в архив, и `agent install` добавляет его к ключам
  узла. Без ключа воркеры ставятся, но с API не обновляются (агент ответит `UPDATE_NOT_VERIFIED`).
- Агент, который после обновления три запуска подряд не вышел на связь, возвращается к прежней
  версии; воркер, который после обновления не стал здоров, — тоже.

| Где собираются архивы      | Как передать закрытый ключ                            |
| -------------------------- | ----------------------------------------------------- |
| `yarn agent:pack`          | `AGENT_SIGNING_KEY=… yarn agent:pack`                 |
| образ в CI (`release.yml`) | секрет репозитория `AGENT_SIGNING_KEY`                |
| `docker build`             | `--secret id=agent_signing_key,env=AGENT_SIGNING_KEY` |

`make deploy` (сборка образа на хосте) секрета не передаёт — воркеры в нём без подписи.

## Разработка

```
agent/
├── workers/wg/       воркер wg: HTTP, повторы и пробы (service.go), узел — настоящий или имитация (system_*.go)
├── workers/socks/    воркер socks
└── internal/
    ├── desired/      настройки state и probes, итог применения
    ├── apply/        применение на узле: конфиги, wg-quick, туннели, пробросы, защита от чужого
    ├── wg/ netcfg/   конфиги wg-quick и дамп; IPIP-туннели, цепочки iptables, проверки чужого
    ├── failover/     выбор маршрута пробросов по пробам
    ├── probe/        ping туннелей, узлов и адресов
    ├── socks/        SOCKS5 через mTLS
    ├── cleanup/ state/  уборка созданного; что создал воркер (state.json)
    ├── sysinfo/      занятые порты, режим WireGuard, дистрибутив и ядро
    └── workerhttp/ shell/ logx/   HTTP на сокете агента и события, внешние команды, журнал
```

Go на машине не нужен — `scripts/go-agent.sh` запускает его в контейнере `golang` (версия —
toolchain из `go.mod`):

```bash
scripts/go-agent.sh test         # go test ./...
scripts/go-agent.sh vet          # go vet ./...
scripts/go-agent.sh fmt          # gofmt -w
scripts/go-agent.sh build        # воркеры под linux и darwin × amd64 и arm64 → agent/dist
agent/workers/wg/linux-check.sh  # воркер wg на настоящем Linux в контейнере (NET_ADMIN)
```

`linux-check.sh` поднимает Debian с wireguard-tools и iptables, запускает воркер на сокете и
проверяет интерфейс и пиров (`wg show`), смену пиров без пересоздания интерфейса, проброс в
цепочках `WG_ADMIN_*`, чужой конфиг, перезапуск, метрики, SIGTERM без разборки и уборку.

Сквозные тесты бэкенда с настоящим агентом (`agents.e2e.ts`, `agent-update.e2e.ts`) берут
программу агента из `agent/dist` (`yarn agent:fetch`; прежняя версия для обновления —
`yarn agent:fetch 1.0.1`) и собирают архив `agent pack` стенда с его ключом проекта.
