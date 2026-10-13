#!/usr/bin/env bash
# Проверка воркера wg на настоящем Linux с настоящим агентом, без бэкенда: контейнер Debian с
# NET_ADMIN (wireguard-tools, iproute2, iptables; wireguard-go — если в ядре нет модуля), агент
# версии AGENT_VERSION (yarn agent:fetch) и сборка воркера; желаемое — файлы desired/wg/*.json
# (перечитываются по SIGHUP), команды — agent command. Проверяет: интерфейс и пиры (wg show),
# смену пиров без перезапуска (wg syncconf), проброс в цепочках WG_ADMIN_*, чужой конфиг,
# перезапуск интерфейса, ошибку применения в пульсе, снятие при удалении настройки, остановку агента без
# разбора и уборку (agent stop-workers --cleanup). Узел машины не затрагивается.
#   agent/workers/wg/linux-check.sh          (агент — AGENT_BIN или agent/dist/v<версия>)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IMAGE="${CHECK_IMAGE:-debian:bookworm-slim}"
case "$(docker info -f '{{.Architecture}}')" in aarch64 | arm64) arch=arm64 ;; *) arch=amd64 ;; esac
version="$(tr -d '[:space:]' <"$ROOT/agent/workers/wg/VERSION")"
agent_version="$(sed -n 's/^AGENT_VERSION=//p' "$ROOT/.env.example")"
agent="${AGENT_BIN:-$ROOT/agent/dist/v$agent_version/agent-linux-$arch}"
[ -x "$agent" ] || {
  echo "нет $agent — yarn agent:fetch (или AGENT_BIN=…)" >&2
  exit 1
}

"$ROOT/scripts/go-agent.sh" build linux "$arch" >/dev/null
echo "Агент: $agent; воркер: agent/dist/wg-$version-linux-$arch"

docker run --rm -i --cap-add NET_ADMIN --device /dev/net/tun \
  -v "$agent:/usr/local/bin/agent:ro" \
  -v "$ROOT/agent/dist/wg-$version-linux-$arch:/check/wg-run:ro" \
  -v "$ROOT/agent/workers/wg/cleanup:/check/wg-cleanup:ro" \
  "$IMAGE" bash -s <<'CHECK'
set -euo pipefail
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() {
  printf '\033[31m✗ %s\033[0m\n' "$*"
  tail -n 40 /tmp/agent.log
  agent status -config /opt/check/agent.yaml --json 2>&1 | head -c 3000
  exit 1
}

apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  wireguard-tools wireguard-go iproute2 iptables conntrack iputils-ping jq procps >/dev/null 2>&1

DIR=/opt/check
mkdir -p $DIR/workers/wg $DIR/desired/wg
cp /check/wg-run $DIR/workers/wg/run
cp /check/wg-cleanup $DIR/workers/wg/cleanup
cat >$DIR/agent.yaml <<'YAML'
dataDir: /var/lib/check-agent
update:
  mode: disabled
workers:
  - path: workers/wg
    env:
      WG_DRY_RUN: "0"
YAML
CFG="-config $DIR/agent.yaml"
: >/tmp/agent.log

# until_ok ОПИСАНИЕ КОМАНДА… — ждать условия до 30 с.
until_ok() {
  what=$1
  shift
  for _ in $(seq 150); do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; done
  fail "не дождались: $what"
}
wg_status() { agent status $CFG --json | jq -e ".status.workers[] | select(.name == \"wg\") | $1"; }

PRIV=$(wg genkey)
PEER1=$(wg genkey | wg pubkey)
PEER2=$(wg genkey | wg pubkey)
peer() { printf '{"publicKey":"%s","presharedKey":null,"allowedIps":"%s"}' "$1" "$2"; }
# state ВЕРСИЯ ПИРЫ — настройка state воркера (desired/wg/state.json) и SIGHUP агенту.
state() {
  jq -n --argjson v "$1" --arg priv "$PRIV" --argjson peers "$2" '{
    version: $v, nodeId: "n1", nodeName: "check",
    interfaces: [{name: "wg0", enabled: true, listenPort: 51820, addressCidr: "10.77.0.1/24",
      addressV6Cidr: null, privateKey: $priv, mtu: 1420, natEnabled: true,
      customPostUp: null, customPostDown: null, peers: $peers}],
    tunnels: [],
    forwards: [{id: "f1", proto: "udp", listenPort: 51900, targetIp: "10.77.0.2", targetPort: 51820}]}' \
    >$DIR/desired/wg/state.json
  kill -HUP $AGENT
}

agent run $CFG >>/tmp/agent.log 2>&1 &
AGENT=$!
until_ok "воркер wg работает" wg_status '.state == "running" and .health.ok == true'
ok "агент без бэкенда, воркер wg зарегистрирован, пульс ok"

state 1 "[$(peer "$PEER1" 10.77.0.2/32)]"
until_ok "пир в wg show" sh -c "wg show wg0 peers | grep -q $PEER1"
until_ok "настройка state применена" wg_status '.configs.state.ok == true'
ok "wg0 поднят, пир в wg show, настройка state применена"
iptables -t nat -S WG_ADMIN_PRE | grep -q 'dport 51900 -j DNAT --to-destination 10.77.0.2:51820' || fail "нет DNAT в WG_ADMIN_PRE"
iptables -S FORWARD | head -3 | grep -q WG_ADMIN_FWD || fail "нет перехода на WG_ADMIN_FWD"
ok "проброс udp/51900 в цепочках WG_ADMIN_*"
[ "$(stat -c %a /etc/wireguard/wg0.conf)" = 600 ] || fail "права конфига"
[ -f /var/lib/wg-admin/state.json ] || fail "нет state.json"

ifindex=$(cat /sys/class/net/wg0/ifindex)
state 2 "[$(peer "$PEER1" 10.77.0.2/32),$(peer "$PEER2" 10.77.0.3/32)]"
until_ok "второй пир" sh -c '[ "$(wg show wg0 peers | wc -l)" = 2 ]'
[ "$(cat /sys/class/net/wg0/ifindex)" = "$ifindex" ] || fail "интерфейс пересоздан при смене пиров"
ok "второй пир — wg syncconf, интерфейс не пересоздан"

restart=$(agent command $CFG wg interface.restart '{"name":"wg0"}')
[ "$(echo "$restart" | jq -r .status)" = up ] && ip link show wg0 >/dev/null || fail "перезапуск: $restart"
if agent command $CFG wg interface.restart '{"name":"wg7"}' >/tmp/restart.out 2>&1; then fail "перезапуск неизвестного интерфейса прошёл"; fi
grep -q INTERFACE_NOT_FOUND /tmp/restart.out || fail "неизвестный интерфейс: $(cat /tmp/restart.out)"
ok "команда interface.restart: wg0 перезапущен, неизвестный — INTERFACE_NOT_FOUND"

printf '[Interface]\nPrivateKey = %s\nListenPort = 51999\n' "$(wg genkey)" >/etc/wireguard/wg9.conf
jq '.version = 3 | .interfaces[0].name = "wg9" | .interfaces[0].listenPort = 51821 | .forwards = []' \
  $DIR/desired/wg/state.json >/tmp/state.json
mv /tmp/state.json $DIR/desired/wg/state.json
kill -HUP $AGENT
until_ok "wg0 снят как удалённый из конфигурации" sh -c '! ip link show wg0'
grep -q 51999 /etc/wireguard/wg9.conf || fail "чужой конфиг перезаписан"
until_ok "ошибка применения — в сообщении пульса, ok не падает" \
  wg_status '.health.ok == true and (.health.message | test("чужой конфиг"))'
ok "чужой wg9.conf не тронут (ошибка в пульсе), wg0 снят"
rm /etc/wireguard/wg9.conf

state 4 "[$(peer "$PEER1" 10.77.0.2/32)]"
until_ok "wg0 снова поднят" ip link show wg0
rm $DIR/desired/wg/state.json
kill -HUP $AGENT
until_ok "настройка удалена — интерфейс снят" sh -c '! ip link show wg0'
ok "настройка state удалена — wg0 и проброс сняты"

state 5 "[$(peer "$PEER1" 10.77.0.2/32)]"
until_ok "wg0 поднят" ip link show wg0
kill -TERM $AGENT
wait $AGENT || true
ip link show wg0 >/dev/null 2>&1 || fail "остановка агента сняла интерфейс — должна оставить"
pgrep -x run >/dev/null || fail "воркер остановился вместе с агентом"
ok "агент остановлен: воркер работает дальше, wg0 остался"

agent stop-workers --cleanup $CFG >>/tmp/agent.log 2>&1 || fail "stop-workers --cleanup"
! ip link show wg0 >/dev/null 2>&1 || fail "wg0 после уборки"
! iptables -t nat -S WG_ADMIN_PRE >/dev/null 2>&1 || fail "цепочка WG_ADMIN_PRE после уборки"
! iptables -S FORWARD | grep -q WG_ADMIN || fail "переход на WG_ADMIN_FWD после уборки"
[ ! -f /var/lib/wg-admin/state.json ] && [ ! -f /etc/wireguard/wg0.conf ] || fail "файлы после уборки"
ok "уборка (./cleanup): интерфейс, цепочки, конфиги и state.json убраны"
echo "Все проверки пройдены"
CHECK
