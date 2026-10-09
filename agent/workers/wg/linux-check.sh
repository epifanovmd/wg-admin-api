#!/usr/bin/env bash
# Проверка воркера wg на настоящем Linux без агента: контейнер Debian с NET_ADMIN
# (wireguard-tools, iproute2, iptables, conntrack; wireguard-go — если в ядре нет модуля),
# воркер на unix-сокете, запросы как от агента. Проверяет: интерфейс и пиры (wg show), смену
# пиров без перезапуска (wg syncconf), проброс в цепочках WG_ADMIN_*, чужой конфиг,
# перезапуск, метрики, снятие (DELETE /config/state) и уборку (POST /cleanup). Узел машины не
# затрагивается. Нужен Docker; Go — в контейнере (scripts/go-agent.sh).
#   agent/workers/wg/linux-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IMAGE="${CHECK_IMAGE:-debian:bookworm-slim}"
case "$(docker info -f '{{.Architecture}}')" in aarch64 | arm64) arch=arm64 ;; *) arch=amd64 ;; esac
version="$(tr -d '[:space:]' <"$ROOT/agent/workers/wg/VERSION")"

"$ROOT/scripts/go-agent.sh" build linux "$arch" >/dev/null
echo "Сборка: agent/dist/wg-$version-linux-$arch"

docker run --rm -i --cap-add NET_ADMIN --device /dev/net/tun \
  -v "$ROOT/agent/dist/wg-$version-linux-$arch:/usr/local/bin/wg-worker:ro" \
  "$IMAGE" bash -s <<'CHECK'
set -euo pipefail
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*"; cat /tmp/worker.log; exit 1; }

apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  wireguard-tools wireguard-go iproute2 iptables conntrack iputils-ping curl jq >/dev/null 2>&1

SOCK=/run/wg-worker.sock
AGENT_WORKER_SOCKET=$SOCK /usr/local/bin/wg-worker >/tmp/worker.log 2>&1 &
WORKER=$!
for _ in $(seq 50); do [ -S $SOCK ] && break; sleep 0.1; done
req() { curl -sS --unix-socket $SOCK -X "$1" "http://worker$2" ${3:+-H 'Content-Type: application/json' -d "$3"}; }
code() { curl -sS -o /dev/null -w '%{http_code}' --unix-socket $SOCK -X "$1" "http://worker$2"; }

health=$(req GET /health)
[ "$(echo "$health" | jq .ok)" = true ] || fail "health: $health"
ok "health: ok, wgMode=$(echo "$health" | jq -r .info.wgMode), $(echo "$health" | jq -r .info.wgVersion)"

PRIV=$(wg genkey)
PEER1=$(wg genkey | wg pubkey)
PEER2=$(wg genkey | wg pubkey)
state() { # state VERSION PEERS_JSON
  jq -n --argjson v "$1" --arg priv "$PRIV" --argjson peers "$2" '{version: $v, data: {
    version: $v, nodeId: "n1", nodeName: "check",
    interfaces: [{name: "wg0", enabled: true, listenPort: 51820, addressCidr: "10.77.0.1/24",
      addressV6Cidr: null, privateKey: $priv, mtu: 1420, natEnabled: true,
      customPostUp: null, customPostDown: null, peers: $peers}],
    tunnels: [],
    forwards: [{id: "f1", proto: "udp", listenPort: 51900, targetIp: "10.77.0.2", targetPort: 51820}]}}'
}

result=$(req PUT /config/state "$(state 1 "[{\"publicKey\":\"$PEER1\",\"presharedKey\":null,\"allowedIps\":\"10.77.0.2/32\"}]")")
[ "$(echo "$result" | jq -r '.interfaces[0].status')" = up ] || fail "применение: $result"
[ "$(echo "$result" | jq '.errors | length')" = 0 ] || fail "ошибки: $result"
wg show wg0 peers | grep -q "$PEER1" || fail "пира нет в wg show"
ok "wg0 поднят, пир в wg show; маршрут f1: $(echo "$result" | jq -c '.routes[0]')"
iptables -t nat -S WG_ADMIN_PRE | grep -q 'dport 51900 -j DNAT --to-destination 10.77.0.2:51820' || fail "нет DNAT в WG_ADMIN_PRE"
iptables -S FORWARD | head -3 | grep -q WG_ADMIN_FWD || fail "нет перехода на WG_ADMIN_FWD"
ok "проброс udp/51900 в цепочках WG_ADMIN_*"
[ "$(stat -c %a /etc/wireguard/wg0.conf)" = 600 ] || fail "права конфига"
[ -f /var/lib/wg-admin/state.json ] || fail "нет state.json"

ifindex=$(cat /sys/class/net/wg0/ifindex)
result=$(req PUT /config/state "$(state 2 "[{\"publicKey\":\"$PEER1\",\"presharedKey\":null,\"allowedIps\":\"10.77.0.2/32\"},{\"publicKey\":\"$PEER2\",\"presharedKey\":null,\"allowedIps\":\"10.77.0.3/32\"}]")")
[ "$(echo "$result" | jq '.errors | length')" = 0 ] || fail "ошибки: $result"
[ "$(wg show wg0 peers | wc -l)" = 2 ] || fail "второго пира нет"
[ "$(cat /sys/class/net/wg0/ifindex)" = "$ifindex" ] || fail "интерфейс пересоздан при смене пиров"
ok "второй пир — wg syncconf, интерфейс не пересоздан"

printf '[Interface]\nPrivateKey = %s\nListenPort = 51999\n' "$(wg genkey)" >/etc/wireguard/wg9.conf
foreign=$(jq -n --arg priv "$PRIV" '{version: 3, data: {version: 3, nodeId: "n1", nodeName: "check",
  interfaces: [{name: "wg9", enabled: true, listenPort: 51821, addressCidr: "10.78.0.1/24", addressV6Cidr: null,
    privateKey: $priv, mtu: null, natEnabled: false, customPostUp: null, customPostDown: null, peers: []}],
  tunnels: [], forwards: []}}')
result=$(req PUT /config/state "$foreign")
echo "$result" | jq -r '.interfaces[0].message' | grep -q 'чужой конфиг' || fail "чужой конфиг: $result"
grep -q 51999 /etc/wireguard/wg9.conf || fail "чужой конфиг перезаписан"
! ip link show wg0 >/dev/null 2>&1 || fail "wg0 не снят, хотя его нет в конфигурации"
[ "$(echo "$(req GET /health)" | jq .ok)" = true ] || fail "ошибка применения уронила ok"
ok "чужой wg9.conf не тронут (ошибка интерфейса), wg0 снят как удалённый из конфигурации"
rm /etc/wireguard/wg9.conf

req PUT /config/state "$(state 4 "[{\"publicKey\":\"$PEER1\",\"presharedKey\":null,\"allowedIps\":\"10.77.0.2/32\"}]")" >/dev/null
restart=$(req POST /interfaces/wg0/restart)
[ "$(echo "$restart" | jq -r .status)" = up ] && ip link show wg0 >/dev/null || fail "restart: $restart"
[ "$(code POST /interfaces/wg7/restart)" = 404 ] || fail "restart неизвестного — не 404"
ok "перезапуск wg0; неизвестный интерфейс — 404"

metrics=$(req GET /metrics)
[ "$(echo "$metrics" | jq -r '.interfaces[0].peers[0].publicKey')" = "$PEER1" ] || fail "метрики: $metrics"
ok "метрики: $(echo "$metrics" | jq -c '{interfaces: [.interfaces[] | {name, peers: (.peers | length)}], forwards}')"

kill -TERM $WORKER && wait $WORKER || true
ip link show wg0 >/dev/null 2>&1 || fail "SIGTERM снял интерфейс — должен оставить"
ok "SIGTERM: воркер вышел, wg0 остался"
AGENT_WORKER_SOCKET=$SOCK /usr/local/bin/wg-worker >>/tmp/worker.log 2>&1 &
WORKER=$!
for _ in $(seq 50); do [ "$(code GET /health 2>/dev/null)" = 200 ] && break; sleep 0.1; done

[ "$(code POST /cleanup)" = 204 ] || fail "cleanup"
! ip link show wg0 >/dev/null 2>&1 || fail "wg0 после уборки"
! iptables -t nat -S WG_ADMIN_PRE >/dev/null 2>&1 || fail "цепочка WG_ADMIN_PRE после уборки"
! iptables -S FORWARD | grep -q WG_ADMIN || fail "переход на WG_ADMIN_FWD после уборки"
[ ! -f /var/lib/wg-admin/state.json ] && [ ! -f /etc/wireguard/wg0.conf ] || fail "файлы после уборки"
ok "уборка: интерфейс, цепочки, конфиги и state.json убраны (новый процесс воркера — по state.json)"
kill -TERM $WORKER
echo "Все проверки пройдены"
CHECK
