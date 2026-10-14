# Папка агента

Всё, что агент делает на машине разработчика и на узлах, — здесь: настройки агента и воркеры
проекта `wg` и `socks`. Сам агент — отдельный проект
([github.com/epifanovmd/agent](https://github.com/epifanovmd/agent)): программа, протокол
([PROTOCOL.md](https://github.com/epifanovmd/agent/blob/main/docs/PROTOCOL.md)) и пакеты на Go
`protocol` и `worker`, на которых написаны воркеры. Версия агента — `AGENT_VERSION` в
`.env.example`.

```
agent/
├── agent.yaml        машина разработчика — yarn agent (воркер wg — в имитации)
├── agent.prod.yaml   узлы WireGuard: поверх agent.yaml (экземпляр wg, root, пакеты, sysctl)
├── agent.docker.yaml  агент в контейнере: поверх agent.prod.yaml (том данных, без самообновления)
├── package/          файлы архива для получателя: Dockerfile, compose.yml, docker-entrypoint.sh,
│                     .env.example, .dockerignore, README.md
├── workers/wg/       воркер wg (Go): интерфейсы, туннели, пробросы, пробы
├── workers/socks/    воркер socks (Go): SOCKS5-прокси через mTLS
├── internal/, go.mod общий Go-код воркеров
├── go-worker.sh      сборка Go-воркера: Go на машине, иначе в контейнере (scripts/go-agent.sh)
├── dev.sh            yarn agent*: программа агента версии AGENT_VERSION, порт и токен API
├── agent             программа агента (не в git: yarn agent скачивает её сам)
├── bundle/           архив для узлов (yarn agent:pack / make agent-archive, не в git) — его раздаёт API
└── dist/             сборки агента для сквозных тестов (yarn agent:fetch) и воркеров, не в git
```

## Кто есть кто

- **Агент** — одна программа на узле. Держит связь с бэкендом (HTTPS: вниз поток SSE с
  желаемым и командами, вверх POST), хранит желаемое на диске, присылает метрики узла, пишет
  журнал, обновляет себя и воркеры. Своей предметной области у агента нет: всё, что касается
  WireGuard, делают воркеры.
- **Воркер** — программа на Go, которую запускает агент; с агентом она говорит через его
  unix-сокет (пакет `worker`): регистрация с манифестом, настройки, команды, события, пульс с
  метриками.
- **Настройки агента** — `agent.yaml` и файлы поверх него (`extends`). Проверить и посмотреть
  итог — `yarn agent config check` (или `--env prod`).

```
бэкенд ──HTTPS (SSE ↓, POST ↑)──► агент ──unix-сокет агента──► воркер wg     (интерфейсы, туннели, пробросы)
                                                          └──► воркер socks  (SOCKS5-прокси через mTLS)
```

Бэкенд кладёт в желаемое агента **настройки** воркеров (ключ и значение JSON с версией). Агент
хранит их у себя и передаёт воркеру; после перезапуска передаёт последние сохранённые — узел
работает и без связи с бэкендом. Итог применения ключа (`ok` или ошибка) агент возвращает
бэкенду в своём состоянии, подробности воркер wg присылает событием. Формат настроек, команд,
событий и метрик со стороны бэкенда — `src/modules/wg-agent/wg-worker.contract.ts`, со стороны
воркеров — `internal/contract`; их меняют вместе.

## Агент на своей машине

```bash
yarn dev                          # API (в .env.development — AGENT_BOOTSTRAP_TOKEN)
yarn agent                        # агент с воркерами wg и socks (agent.yaml); Ctrl+C — остановка
yarn agent status                 # работает ли агент (запущенный в другом терминале)
yarn agent config check           # проверить настройки и показать итоговые значения
```

`yarn agent` (это `agent/dev.sh`) скачивает программу агента версии `AGENT_VERSION`, если её ещё
нет (со сверкой sha256), берёт `SERVER_PORT` и `AGENT_BOOTSTRAP_TOKEN` из `.env.development`
(другой файл — `ENV_FILE=…`) и запускает `agent/agent run`. Токен — тот же, что у API, не короче
32 символов.

- Воркеры идут прямо из исходников: `run` в папке воркера собирает его под эту машину в `.bin/`
  и запускает (`go-worker.sh run`). Go нет — сборка в контейнере `golang` (`scripts/go-agent.sh`),
  нужен Docker. Правки видны после перезапуска воркера (`yarn agent restart --worker wg`).
- Воркер wg — в имитации (`WG_DRY_RUN=1`): системные команды не выполняются, конфиги и
  `state.json` — в каталоге данных воркера (`WORKER_STATE_DIR`).
- Имя агента — `AGENT_NAME` (по умолчанию `dev-$USER`), привязать к ноде — `AGENT_NODE_ID=<id>`
  (метка `nodeId`). Данные агента — `.agent/data`: удалить — агент зарегистрируется заново и
  привяжется к ноде по метке или имени. Второй агент — `AGENT_DIR=.agent-2 AGENT_NAME=dev-2 yarn agent`.
- Здесь агент себя не обновляет (`update: disabled`): версию задаёт `AGENT_VERSION`.

## Воркер wg

Окружение (агент сам задаёт `AGENT_SOCKET`, `AGENT_WORKER_TOKEN`, `AGENT_WORKER_NAME`,
`WORKER_STATE_DIR`):

| Переменная      | По умолчанию        | Что                                                                                |
| --------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `WG_CONFIG_DIR` | `/etc/wireguard`    | конфиги wg-quick; на Ubuntu AppArmor разрешает wg-quick читать только этот каталог |
| `WG_STATE_DIR`  | `/var/lib/wg-admin` | `state.json` — что создал воркер: его интерфейсы и туннели                         |
| `WG_DRY_RUN`    | —                   | `1` — имитация без системных команд (ниже); каталоги — в `WORKER_STATE_DIR`        |

Манифест (`workers/wg/manifest.go`): настройки `state` и `probes`, команда `interface.restart`,
события `state.result`, `route.changed`, `node.info`. Агент пропускает к воркеру только
объявленное, бэкенд проверяет значения по схемам манифеста.

### Настройка `state` — желаемое состояние узла

```jsonc
{
  "version": 42, // версия конфигурации ноды на бэкенде (wg_nodes.config_version)
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

- Неверный JSON, имя интерфейса или туннеля, протокол или порт, которые нельзя подставить в
  команды, — отказ в настройке `CONFIG_REJECTED` с текстом (бэкенд пишет его в ошибку
  применения ноды); узел не меняется.
- Применения идут строго по одному; пока одно идёт, пришедшая новая версия применяется следом.
- **Итог** — событие `state.result` после каждого применения (новая версия, повтор, смена
  маршрута); событие, которое агент не принял (воркер ещё не зарегистрирован), воркер присылает
  снова:

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

Удалили ключ `state` — воркер снимает всё своё (как пустая настройка).

### Настройка `probes` — проверка связности с другими узлами

`{ "targets": [{ "nodeId": "…", "host": "203.0.113.9" }] }`. Раз в ~60 с (и сразу после
настройки) — 10 ping до каждого узла; итог — в метриках `nodeProbes`.

### Команда, сведения об узле, пульс

- **`interface.restart`** `{ name }` — `wg-quick down` и `up` → `{ name, status: "up" }`; нет в
  настройке — `INTERFACE_NOT_FOUND`, выключен — `INTERFACE_DISABLED`, ошибка —
  `RESTART_FAILED`.
- **`node.info`** — сведения об узле при изменении (проверка раз в 10 с): `wgVersion`, `wgMode`
  (`kernel` | `userspace`), `distro`, `kernel`, `udpPorts`, `tcpPorts` — бэкенд держит их в
  `osInfo` ноды (по занятым портам — проверка конфликтов пробросов).
- **Пульс** — раз в 10 с; пока бэкенд наблюдает за узлом (админку смотрят) — раз в секунду.
  `ok: false` — только если воркер не может работать вообще (нет `wg`, `wg-quick` или `ip`; не
  Linux без имитации). Ошибки применения — в `message`, `ok` они не роняют: иначе агент откатил
  бы обновление воркера. Метрики пульса — последние значения, пробы идут в фоне:

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

**Остановка и уборка.** SIGTERM (перезапуск или обновление воркера, остановка агента) — воркер
выходит, **ничего не разбирая**: VPN и пробросы продолжают работать, новый процесс застаёт их на
месте. Уборка — `./cleanup` (`wg cleanup`), её выполняет агент при отзыве, удалении воркера из
настроек и `agent uninstall`: `wg-quick down` интерфейсов воркера, удаление его туннелей `wgt*`,
цепочек `WG_ADMIN_*` и переходов на них, конфигов воркера и `state.json`.

### Имитация (`WG_DRY_RUN=1`)

Для разработки на macOS и проверки связки с бэкендом: ни одной системной команды. Конфиги
интерфейсов для наглядности пишутся в `WG_CONFIG_DIR`, `state.json` — в `WG_STATE_DIR` (по
умолчанию — в `WORKER_STATE_DIR` воркера). Включённые интерфейсы — `up`, выключенные — `down`,
туннели и пробросы принимаются, маршрут — первый кандидат. Метрики синтетические: счётчики пиров
растут со временем, рукопожатие — только что, адрес пира — `203.0.113.<n>:51820`; пробы туннелей
и узлов — 1–5 мс без потерь. Сведения узла — `wgVersion: "dry-run"`, `wgMode: "userspace"`.
Защита от чужого конфига работает и здесь.

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

Новые прокси начинают слушать, удалённые и сменившие порт закрываются; новые сертификаты
действуют без перезапуска слушателя; отзыв сертификата или пользователя сразу рвёт его
соединения. Прокси, который не слушает (порт занят), — в пульсе (`ok: false` с причиной); воркер
повторяет его раз в 25 с. Метрики пульса — `{ proxies: [{ id, connections, rxBytes, txBytes }] }`.
Удалили ключ — все прокси закрываются.

Прокси живут в процессе воркера: SIGTERM закрывает их, уборка не нужна. Работает на любой ОС,
имитации нет.

## Воркеры: сборка и версии

У каждого воркера в папке исполняемые файлы, все вызывают `agent/go-worker.sh`:

| Файл      | Кто вызывает                       | Что делает                                                                                       |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `build`   | `agent pack`                       | программа под платформу узла (`GOOS`, `GOARCH`, `OUT` задаёт pack) → `$OUT/run`, рядом `cleanup` |
| `run`     | `agent run` на машине разработчика | сборка под эту машину в `.bin/` и запуск; на узле `run` — сама программа из архива               |
| `cleanup` | агент (отзыв, `agent uninstall`)   | `./run cleanup` — уборка созданного воркером на узле (только у wg)                               |

Go на машине не обязателен: без него `go-worker.sh` собирает в контейнере `golang` версии
toolchain из `go.mod` (`scripts/go-agent.sh`). Модуль агента Go берёт прямо с GitHub
(`GOPRIVATE=github.com/epifanovmd/*`), мимо прокси: версия агента пока перевыпускается под тем же
номером, сумма модуля — в `go.sum`.

- **Версия** — файл `VERSION` воркера (вшивается в программу, `-X main.version`). Изменили код
  воркера — поднимите его `VERSION` (общий код `internal/`, `go.mod`, `go.sum` — оба воркера):
  `scripts/check-agent-version.sh` в CI сверяет это с последним тегом `v*`. Разные сборки под
  одной версией агент не различит.
- **Обновить воркер на узлах** — поднять `VERSION`, новый образ API (или `yarn agent:pack`) и
  обновление воркера на странице агента ноды (`POST /api/v1/agents/{id}/workers/<имя>/update`).

## Как агент попадает на узел

Принцип один — вручную, из веба и в CI: **архив агента** (все платформы в одном). Он
самодостаточен: распаковал — и запускай службой, на месте или в Docker.

```bash
make agent-archive                # = yarn agent:pack → agent/bundle: agent-prod-<версия>.tar.gz (linux amd64 и arm64 в одном), release/, install.sh
make agent-image                  # образ агента из архива под эту машину (его Dockerfile)
```

`agent pack --env prod` кладёт в один архив программы агента под все платформы (`bin/`, их выбирает
скрипт `agent` по `uname`), `agent.yaml` + `agent.prod.yaml`, воркеры `wg` и `socks`, собранные под
каждую платформу (их `build`), их подписанные сборки (`release/`) — для обновления воркеров с API,
`bundle.json`, а по `pack.files` (`agent.prod.yaml`) — файлы получателя из `package/`
(`Dockerfile`, `compose.yml`, `docker-entrypoint.sh`, `.env.example`, `README.md`) и
`agent.docker.yaml`. Секретов в общем архиве нет: адрес и токен получатель кладёт в `agent/.env`
(образец `.env.example`; его читают `envFiles` настроек и `compose.yml`). Без адреса и токена агент
не запустится (`server.required` агента) и скажет, чего не хватает; адрес — только `https://`
(`http://` — `AGENT_SERVER_ALLOW_INSECURE=true`). Тот же архив собирает стадия образа API
`agent-bundle` (раздаёт API) и CI (артефакт сборки, файлы релиза GitHub и образ
`…:<версия>-agent` из архива). `agent install` на узле ставит агента службой по `install:` из
`agent.prod.yaml`:

- экземпляр `wg` — своя служба `agent-wg` и свои каталоги рядом с агентами других бэкендов;
- `privileged: true` — агент и воркеры от root без ограничений systemd: воркер wg настраивает
  сеть, iptables и пишет в `/etc/wireguard`;
- пакеты `wireguard-tools iproute2 iptables conntrack iputils-ping` (имена для apt;
  `packagesByManager` — для dnf, yum, apk, zypper, где пакеты называются иначе);
- `sysctl`: `net.ipv4.ip_forward=1`, `net.ipv6.conf.all.forwarding=1`;
- воркер wg — на настоящей системе (`WG_DRY_RUN=0`, `/etc/wireguard`, `/var/lib/wg-admin`).

Адрес API и токен регистрации передаёт установка. Новый агент ждёт подтверждения бэкенда и
запускает воркеры после него. Узел — Linux с systemd; ядро без модуля WireGuard (старше 5.6) —
поставьте `wireguard-go`, wg-quick сам возьмёт его.

| Как                  | Что сделать                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| вручную, архивом     | `scp agent/bundle/agent-prod-….tar.gz узел:` → `tar xzf … && cd agent && cp .env.example .env` (адрес, токен) → `sudo ./agent install --env prod`, `sudo ./agent run --env prod` или `docker compose up -d --build` |
| архив с токеном      | веб: «Установить агента» → «Архив» (или `POST /api/v1/wg/nodes/{id}/agent/issue/archive`): тот же архив и `.env` с одноразовым токеном ноды; одноразовая ссылка — `…/issue/link`, только `.env` — `…/issue/env`     |
| одной командой с API | токен и команда — при создании ноды или `POST /api/v1/wg/nodes/{id}/install-command` (`mode: docker` — Docker Compose из архива)                                                                                    |
| с API по SSH         | `POST /api/v1/wg/nodes/{id}/provision` — то же самое на узле, токен — файлом; прежний агент снимается сам (ниже)                                                                                                    |
| удалить              | `sudo agent-wg uninstall [--purge]` или `POST /api/v1/wg/nodes/{id}/uninstall`                                                                                                                                      |

Команда установки с API:

```bash
curl -fsSL 'https://<api>/agent/v1/bundle/install.sh' | sudo sh -s -- --server 'https://<api>' \
  --bundle 'https://<api>/agent/v1/bundle/agent.tar.gz' --token '<токен>' --name '<нода>'
```

Флагов экземпляра, воркеров, пакетов и прав в ней нет — всё это в `agent.prod.yaml` архива. API
раздаёт архив из `AGENT_BUNDLE_DIR` (`/agent/v1/bundle/agent.tar.gz` — все платформы,
`install.sh`; без входа: секретов в архиве нет); в образе API (`/app/agent/bundle`) его собирает
стадия `agent-bundle` `Dockerfile`, для разработки — `yarn agent:pack`.

**Docker.** Воркер wg настраивает сам узел, поэтому контейнер агента работает в сети узла
(`network_mode: host`) и с правами на неё (`privileged`): `compose.yml` архива, данные агента и
`/etc/wireguard` — тома, пересылку пакетов включает `docker-entrypoint.sh`. Команда с API
(`mode: docker`) скачивает архив, пишет `.env` (0600) и запускает `docker compose up -d --build`. В
контейнере агент себя не обновляет — обновляют архивом и образом.

**Выдача агента получателю** (ядро, `AgentIssueService`): архив с `.env` (адрес, одноразовый токен
с меткой ноды, имя ноды) — файлом или одноразовой ссылкой (`GET /agent/v1/bundle/issued/{id}`,
один раз и до срока), только `.env` — для общего архива или образа (`--env-file`). Архив с
токеном на сервере не хранится; выдача — в журнале аудита.

На узле (экземпляр `wg`):

| Что               | Где                                                   |
| ----------------- | ----------------------------------------------------- |
| программа         | `/opt/agent-wg/bin/agent` (ссылка — `agent-wg`)       |
| настройки и токен | `/etc/agent-wg/agent.yaml`, `/etc/agent-wg/agent.env` |
| данные и воркеры  | `/var/lib/agent-wg`                                   |
| служба            | `agent-wg` (`systemctl status agent-wg`)              |

```bash
sudo agent-wg status                       # состояние (pending, active, revoked), связь, воркеры
sudo agent-wg logs -f                      # журнал агента и воркеров (journalctl -u agent-wg)
sudo agent-wg logs --worker wg             # последние записи журнала воркера
sudo agent-wg command wg interface.restart '{"name":"wg0"}'   # команда воркеру с узла
sudo agent-wg upgrade                      # новая версия агента
sudo wg show                               # интерфейсы WireGuard
sudo agent-wg uninstall                    # удалить: воркеры убирают за собой (./cleanup)
sudo agent-wg uninstall --purge            # и настройки, данные, поставленные установкой пакеты
```

Удаление агента или ноды в админке отзывает агента: он останавливает воркеры с уборкой и больше
не выходит на связь; программу с узла убирает `uninstall` (или удаление по SSH).

### Переход с агента прежнего поколения

На узлах, где стоит агент прежнего поколения (`agent-wg` с данными без `agent.db`), новый агент
ставится по тем же путям, поэтому прежний снимается первым — **без уборки**: его воркеры по
SIGTERM ничего не разбирают, интерфейсы, туннели и пробросы продолжают работать, а
`/etc/wireguard` и `/var/lib/wg-admin` новый воркер wg считает своими и сходится к желаемому без
разрыва. Установка по SSH (`provision`) делает это сама (`removePreviousAgent` в
`src/modules/wg-provision/provision-plan.ts`); при установке вручную — до команды установки:

```bash
sudo systemctl disable --now agent-wg          # служба без уборки
cat /var/lib/agent-wg/processes/*.json         # pid воркеров прежнего агента — завершить: sudo kill <pid>
sudo rm -rf /opt/agent-wg /etc/agent-wg /var/lib/agent-wg /etc/systemd/system/agent-wg.service /usr/local/bin/agent-wg
sudo systemctl daemon-reload
```

Нода в админке после обновления API — «ожидает агента» (прежние агенты не переносятся); новый
агент привязывается к ней по токену из команды установки ноды и получает её конфигурацию из БД.
`agent uninstall` прежнего агента **не запускать**: он выполнил бы уборку воркеров и снял VPN.

## Обновления и подписи

- **Агент** берёт свои сборки сам из своего каталога сборок (`update.releases`; по умолчанию —
  релизы GitHub `epifanovmd/agent`): на узле (`update: self`) он проверяет новую версию при
  запуске и раз в `update.checkInterval` и сообщает её бэкенду — агент становится кандидатом на
  обновление. Обновить — со страницы агента (`POST /api/v1/agents/{id}/update`) или
  `sudo agent-wg upgrade` на узле. Сборок агента бэкенд не раздаёт.
- **Воркеры проекта** подписывает `agent pack` ключом проекта из `AGENT_SIGNING_KEY`. Открытый
  ключ попадает в архив, и `agent install` добавляет его к ключам узла. Без ключа воркеры
  ставятся, но с API не обновляются. Пара ключей (Ed25519) — `openssl`:

  ```bash
  openssl genpkey -algorithm ed25519 -outform DER -out signing.der
  echo "AGENT_SIGNING_KEY=$(tail -c 32 signing.der | base64)"
  echo "AGENT_UPDATE_PUBLIC_KEYS=$(openssl pkey -inform DER -in signing.der -pubout -outform DER | tail -c 32 | base64)"
  ```

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
├── workers/wg/       воркер wg: связь с агентом (main.go), настройки, команда, события, пробы и пульс
│                     (service.go), манифест, узел — настоящий или имитация (system_*.go)
├── workers/socks/    воркер socks
└── internal/
    ├── contract/     контракт с бэкендом: настройки state и probes, итоги, метрики
    ├── apply/        применение на узле: конфиги, wg-quick, туннели, пробросы, защита от чужого
    ├── wg/ netcfg/   конфиги wg-quick и дамп; IPIP-туннели, цепочки iptables, проверки чужого
    ├── failover/     выбор маршрута пробросов по пробам
    ├── probe/        ping туннелей, узлов и адресов
    ├── socks/        SOCKS5 через mTLS
    ├── cleanup/ state/  уборка созданного; что создал воркер (state.json)
    ├── sysinfo/      занятые порты, режим WireGuard, дистрибутив и ядро
    └── shell/ logx/  внешние команды, журнал воркера
```

Go на машине не нужен — `scripts/go-agent.sh` запускает его в контейнере `golang` (версия —
toolchain из `go.mod`):

```bash
scripts/go-agent.sh test         # go test ./...
scripts/go-agent.sh vet          # go vet ./...
scripts/go-agent.sh fmt          # gofmt -w
scripts/go-agent.sh build        # воркеры под linux и darwin × amd64 и arm64 → agent/dist
agent/workers/wg/linux-check.sh  # воркер wg с настоящим агентом на настоящем Linux (контейнер, NET_ADMIN)
```

`linux-check.sh` поднимает Debian с wireguard-tools и iptables, запускает настоящего агента без
бэкенда (желаемое — файл `desired/wg/state.json`, команды — `agent command`) со сборкой воркера и
проверяет интерфейс и пиров (`wg show`), смену пиров без пересоздания интерфейса, проброс в
цепочках `WG_ADMIN_*`, перезапуск интерфейса, чужой конфиг, снятие при удалении настройки,
остановку агента без разбора и уборку (`agent stop-workers --cleanup`).

Сквозные тесты бэкенда: сценарии домена — с фейковым агентом на протоколе агента
(`test/e2e/fake-agent.ts`), настоящий агент со сборками воркеров из архива стенда —
`test/e2e/agents.e2e.ts` (программа агента — `yarn agent:fetch`, архив `agent pack` стенд
собирает сам со своим ключом проекта).
