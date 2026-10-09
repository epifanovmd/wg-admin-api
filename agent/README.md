# Воркеры узла: wg и socks

На каждом узле (VPS) работает **агент** — готовая программа
[github.com/epifanovmd/agent](https://github.com/epifanovmd/agent) версии 1.x. Агент держит
связь с бэкендом, хранит настройки, присылает метрики узла (процессор, память, диск, сеть),
пишет журнал и обновляет себя и воркеры. Своей предметной области у агента нет: всё, что
касается WireGuard, делают **воркеры** этого каталога — небольшие программы на Go, которые агент
запускает и с которыми говорит по HTTP через unix-сокет.

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
[спецификации агента](https://github.com/epifanovmd/agent/blob/v1.1.0/sdk/spec/README.md)
(§8 настройки, §9 самочувствие и метрики, §12 воркер и манифест, §13 жизнь воркера).

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
умолчанию — `$TMPDIR/wg-admin-dry`). Включённые интерфейсы — `up`, выключенные — `down`,
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

## Сборки для узлов

Узел получает от бэкенда сборки из двух мест:

| Что                                    | Откуда                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| агент, `install.sh`, воркер `netprobe` | релизы агента на GitHub (`epifanovmd/agent`): бэкенд сам берёт новейший в `^1` |
| воркеры `wg` и `socks`                 | каталог `agent/release` проекта (`AGENT_RELEASES_DIR`)                         |

**Агент.** Бэкенд при запуске и потом раз в час (`AGENT_RELEASES_CHECK_INTERVAL_MS`) спрашивает
GitHub, есть ли новая версия агента в диапазоне `AGENT_RELEASES_RANGE` (по умолчанию `^1`).
Нашёл — пишет в журнал, сообщает админке (сокет `agent:release`), и у агентов узлов появляется
доступное обновление. Пересобирать или перезапускать бэкенд для этого не нужно. Узел скачивает
программу агента прямо с GitHub: бэкенд отвечает перенаправлением. Узлам без доступа к GitHub —
`AGENT_RELEASES_PROXY=true`, тогда бэкенд передаёт файл сам. Своё зеркало или одна закреплённая
версия — `AGENT_RELEASES_URL` (каталог с `manifest.json`), без GitHub совсем —
`AGENT_RELEASES_GITHUB=` (пусто).

**Воркеры проекта.** `agent/release.sh` собирает каталог `agent/release` (в git не попадает):

| Файл                                 | Что                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `wg-<версия>-<os>-<arch>`, `socks-…` | сборки воркеров (linux и darwin × amd64 и arm64), версия — `workers/*/VERSION` |
| `manifest.json`                      | утилита `agent-release` агента: файлы, sha256, подписи, `stopTimeout` воркеров |

Сборок агента в нём нет. В образе бэкенда каталог собирают стадии `agent-workers` и
`agent-release` `Dockerfile` (`/app/agent/release`).

```bash
agent/release.sh                                  # воркеры в agent/release
AGENT_SIGNING_KEY=… agent/release.sh              # подписанные ключом проекта
docker build --secret id=agent_signing_key,env=AGENT_SIGNING_KEY .   # то же в образе
```

Нужны `bash` и `node`; Go или Docker — для сборки воркеров и утилиты `agent-release` (Go нет —
сборка в контейнере `golang`). Переменные: `RELEASE_OUT=каталог` — куда собрать;
`WORKERS_PREBUILT=каталог` — готовые сборки воркеров; `AGENT_RELEASE_TOOL=путь` — готовая
утилита `agent-release` (иначе `go run` той же версии, что `agent-sdk` в `package.json`).

**Подпись.** Агент ставит обновление, только если подпись сборки сходится с одним из открытых
ключей, которые он знает. Ключей два:

- **ключ автора агента** — им подписаны агент и `netprobe` на GitHub; он вшит в программу агента,
  а бэкенд дополнительно передаёт его узлу (`AGENT_RELEASES_PUBLIC_KEY`, по умолчанию — ключ из
  релизов `epifanovmd/agent`);
- **ключ проекта** — им `agent/release.sh` подписывает воркеры `wg` и `socks`
  (`AGENT_SIGNING_KEY` — закрытый ключ из `agent-release keygen`). Бэкенду нужен открытый ключ
  этой пары (`AGENT_UPDATE_PUBLIC_KEY`): он вписывает его в `install.sh`, и узлы проверяют им
  обновления воркеров.

Без ключа проекта воркеры не подписаны: установка сверит их sha256, но обновить воркер с бэкенда
не получится — агент ответит `UPDATE_NOT_VERIFIED`. Скрипт пишет об этом в конце.

**Версии.** Изменили код воркера — поднимите его `VERSION` (общий код `internal/`, `go.mod`,
`go.sum` — оба воркера): `scripts/check-agent-version.sh` в CI сверяет это с последним тегом
`v*`. Разные сборки под одной версией агент не различит.

## Установка на узел

Команду выдаёт бэкенд (адрес, токен и ключи проверки уже вписаны). Узел — Linux с systemd,
агент ставится отдельным экземпляром `wg` (свои пути и служба `agent-wg`, не мешает другим
агентам на узле):

```bash
curl -fsSL https://<бэкенд>/api/v1/agent-link/install.sh | sudo sh -s -- \
  --instance wg --token <токен> --name <имя узла> \
  --worker wg --worker socks --privileged \
  --packages "wireguard-tools iproute2 iptables conntrack iputils-ping" \
  --packages-dnf "wireguard-tools iproute iptables conntrack-tools iputils" \
  --packages-yum "wireguard-tools iproute iptables conntrack-tools iputils" \
  --packages-zypper "wireguard-tools iproute2 iptables conntrack-tools iputils" \
  --sysctl net.ipv4.ip_forward=1 --sysctl net.ipv6.conf.all.forwarding=1
```

- `--worker wg --worker socks` — сборки воркеров с сервера (sha256 сверяется) и запись о них в
  `/etc/agent-wg/agent.yaml` с `release: true` и `stopTimeout: 30s`;
- `--privileged` — агент и воркеры от root без ограничений systemd: воркер wg настраивает сеть,
  iptables и пишет в `/etc/wireguard`;
- `--packages` — имена для apt (Debian, Ubuntu); `--packages-dnf`, `-yum`, `-zypper` — для
  Fedora/RHEL и SUSE, где пакеты называются иначе. Узлы без systemd (Alpine) не поддерживаются;
- ядро без модуля WireGuard (старше 5.6) — поставьте `wireguard-go`: wg-quick сам возьмёт его.

Что потом:

```bash
sudo agent-wg status          # связь, воркеры, последняя ошибка
sudo agent-wg logs -f         # журнал агента и воркеров (journalctl -u agent-wg)
sudo wg show                  # интерфейсы WireGuard
sudo agent uninstall --instance wg           # удалить: воркеры убирают за собой (POST /cleanup)
sudo agent uninstall --instance wg --purge   # и настройки, данные, поставленные установкой пакеты
```

## Локальный запуск

`agent/dev.sh` запускает агента на этой машине с бэкендом из `.env.development`:

```bash
agent/release.sh       # один раз: воркеры (или их соберёт dev.sh под эту машину)
agent/dev.sh run       # на переднем плане; Ctrl+C — остановка агента и воркеров
agent/dev.sh start | stop [--force] | status | logs | check
```

- Регистрация — `AGENT_BOOTSTRAP_TOKEN` из `.env.development` (тот же, что у бэкенда, не короче
  32 символов), адрес — `http://localhost:$SERVER_PORT`. Имя — `AGENT_NAME` (по умолчанию
  `dev-$USER`), метка `nodeId` — из `AGENT_NODE_ID`, если задана.
- Воркер wg на macOS — всегда в имитации; на Linux — тоже, пока не задано `WG_DRY_RUN=0` (тогда
  нужен root). Конфиги имитации — `.agent/wg/wireguard`.
- Программа агента — `AGENT_BIN` или `agent/dist/agent-<версия>/agent-<os>-<arch>` той же версии,
  что `agent-sdk` в `package.json`; её нет — `dev.sh` скачивает сборки с GitHub
  (`agent/fetch-agent.sh`). Воркеры — `WG_WORKER_BIN`, `SOCKS_WORKER_BIN` или сборки под эту
  машину из `agent/release` и `agent/dist` (нет — собираются).
- Данные агента — `.agent/data`: удалите их, и агент зарегистрируется заново. Настройки агента —
  `agent/local/agent.yaml`, обновления выключены.

## Разработка

```
agent/
├── workers/wg/       воркер wg: HTTP, повторы и пробы (service.go), узел — настоящий или имитация (system_*.go)
├── workers/socks/    воркер socks
├── internal/
│   ├── desired/      настройки state и probes, итог применения
│   ├── apply/        применение на узле: конфиги, wg-quick, туннели, пробросы, защита от чужого
│   ├── wg/ netcfg/   конфиги wg-quick и дамп; IPIP-туннели, цепочки iptables, проверки чужого
│   ├── failover/     выбор маршрута пробросов по пробам
│   ├── probe/        ping туннелей, узлов и адресов
│   ├── socks/        SOCKS5 через mTLS
│   ├── cleanup/ state/  уборка созданного; что создал воркер (state.json)
│   ├── sysinfo/      занятые порты, режим WireGuard, дистрибутив и ядро
│   └── workerhttp/ shell/ logx/   HTTP на сокете агента и события, внешние команды, журнал
├── release.sh  fetch-agent.sh  dev.sh  local/agent.yaml
```

Go на машине не нужен — `scripts/go-agent.sh` запускает его в контейнере `golang` (ветка — из
`go.mod`):

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
