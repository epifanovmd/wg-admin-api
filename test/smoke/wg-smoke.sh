#!/usr/bin/env bash
# Интеграционный smoke WG-домена в Docker: бэкенд и агенты нод (нода, релей,
# нода «только туннель», реплика). Реальный wg работает внутри
# Linux-контейнеров (модуль ядра или wireguard-go), хостовая система не
# затрагивается. Запускается вручную, не в CI. Требования: docker, python3,
# собранные образы wg-admin-api:test и wg-admin-agent:test. Бинарь в образе
# агента должен отличаться от раздаваемого бэкендом — шаг обновления ставит
# релизный. Из корня репозитория:
#   docker build -t wg-admin-api:test .
#   docker build -f test/smoke/Dockerfile.agent --build-arg AGENT_VERSION=2.0.0-smoke -t wg-admin-agent:test .
#   bash test/smoke/wg-smoke.sh
# Тестовые UDP/TCP-серверы и клиенты — node в отдельных контейнерах, в сетевом
# пространстве агента (в образе агента только бинарь и утилиты сети).
set -euo pipefail

# Отдельный compose-проект и порт: прогон не трогает рабочий локальный стенд.
PROJECT=${WG_TEST_PROJECT:-wg-smoke}
export WG_LOCAL_PORT=${WG_TEST_PORT:-8381}
BASE_URL=http://localhost:$WG_LOCAL_PORT
SMOKE_DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE="docker compose -p $PROJECT -f $SMOKE_DIR/docker-compose.yml"
NETWORK="${PROJECT}_default"
AGENT_A="$PROJECT-agent-a"
AGENT_B="$PROJECT-agent-b"
ADMIN_EMAIL=admin@wg.local
ADMIN_PASSWORD=wg-local-Admin-2026
NODE_IMAGE=${WG_TEST_NODE_IMAGE:-node:24-alpine}

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

api() { # api METHOD PATH [JSON_BODY]
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" -H "Authorization: Bearer $TOKEN" "$BASE_URL$path")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}"
}

wait_for() { # wait_for SECONDS DESCRIPTION COMMAND...
  local timeout=$1 what=$2; shift 2
  local until=$((SECONDS + timeout))
  while [ $SECONDS -lt $until ]; do
    if "$@" >/dev/null 2>&1; then ok "$what"; return 0; fi
    sleep 2
  done
  fail "не дождались: $what"
}

# in_netns NAME CONTAINER SCRIPT — node-процесс в сетевом пространстве контейнера.
in_netns() {
  docker run -d --name "$PROJECT-ns-$1" --network "container:$2" "$NODE_IMAGE" \
    node -e "$3" >/dev/null
}

cleanup() {
  log "Очистка"
  docker ps -aq --filter "name=$PROJECT-ns-" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker rm -f "$AGENT_A" "$AGENT_B" "$PROJECT-agent-c" "$PROJECT-agent-d" "$PROJECT-client" "$PROJECT-client-x" "$PROJECT-client-r" >/dev/null 2>&1 || true
  $COMPOSE down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Стенд: postgres + redis + api"
$COMPOSE up -d
wait_for 90 "API отвечает" curl -fsS "$BASE_URL/ping"
# /ping отвечает раньше, чем приложение готово (миграции, подключения).
wait_for 90 "API готов" curl -fsS "$BASE_URL/ready"

log "Вход администратора"
TOKEN=$(curl -sS -X POST "$BASE_URL/api/v1/auth/sign-in" \
  -H "Content-Type: application/json" \
  -d "{\"login\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" |
  json "d['tokens']['accessToken']")
[ -n "$TOKEN" ] || fail "не получили токен"
ok "токен получен"

log "Создание нод"
NODE_A=$(api POST /api/v1/wg/nodes '{"name":"node-a"}')
NODE_A_ID=$(echo "$NODE_A" | json "d['node']['id']")
NODE_A_KEY=$(echo "$NODE_A" | json "d['agentKey']")
NODE_B=$(api POST /api/v1/wg/nodes '{"name":"relay-b"}')
NODE_B_ID=$(echo "$NODE_B" | json "d['node']['id']")
NODE_B_KEY=$(echo "$NODE_B" | json "d['agentKey']")
ok "ноды созданы: $NODE_A_ID, $NODE_B_ID"

log "Запуск агентов (NET_ADMIN, wg внутри контейнеров)"
for pair in "a:$NODE_A_KEY" "b:$NODE_B_KEY"; do
  suffix=${pair%%:*}; key=${pair#*:}
  docker run -d --name "$PROJECT-agent-$suffix" --network "$NETWORK" \
    --restart unless-stopped --cap-add NET_ADMIN \
    -e WG_AGENT_BACKEND_URL=http://api:8181 \
    -e WG_AGENT_KEY="$key" \
    wg-admin-agent:test >/dev/null
done

node_status() { api GET "/api/v1/wg/nodes/$1" | json "d['status']"; }
check_online() { [ "$(node_status "$1")" = "online" ]; }
wait_for 60 "агент ноды A online" check_online "$NODE_A_ID"
wait_for 60 "агент релея B online" check_online "$NODE_B_ID"

log "publicHost нод — адреса контейнеров в сети стенда"
IP_A=$(docker inspect -f '{{(index .NetworkSettings.Networks "'"$NETWORK"'").IPAddress}}' "$AGENT_A")
IP_B=$(docker inspect -f '{{(index .NetworkSettings.Networks "'"$NETWORK"'").IPAddress}}' "$AGENT_B")
api PATCH "/api/v1/wg/nodes/$NODE_A_ID" "{\"publicHost\":\"$IP_A\"}" >/dev/null
api PATCH "/api/v1/wg/nodes/$NODE_B_ID" "{\"publicHost\":\"$IP_B\"}" >/dev/null

log "Точка подключения через релей (DNAT)"
ENDPOINT_ID=$(api POST /api/v1/wg/endpoints \
  "{\"name\":\"relay\",\"host\":\"$IP_B\",\"mode\":\"relay\",\"relayNodeId\":\"$NODE_B_ID\",\"forwardMode\":\"dnat\"}" |
  json "d['id']")

log "Интерфейс wg0 на ноде A"
IFACE=$(api POST /api/v1/wg/interfaces \
  "{\"nodeId\":\"$NODE_A_ID\",\"name\":\"wg0\",\"listenPort\":51820,\"addressCidr\":\"10.77.0.1/24\",\"dns\":\"1.1.1.1\",\"endpointId\":\"$ENDPOINT_ID\"}")
IFACE_ID=$(echo "$IFACE" | json "d['id']")

iface_status() { api GET "/api/v1/wg/interfaces/$IFACE_ID" | json "d['status']"; }
check_iface_up() { [ "$(iface_status)" = "up" ]; }
wait_for 60 "интерфейс wg0 поднят агентом" check_iface_up

log "Пир"
PEER=$(api POST /api/v1/wg/peers "{\"interfaceId\":\"$IFACE_ID\",\"name\":\"laptop\"}")
PEER_ID=$(echo "$PEER" | json "d['id']")
PEER_PUB=$(echo "$PEER" | json "d['publicKey']")
[ "$(echo "$PEER" | json "d['addressV4']")" = "10.77.0.2" ] || fail "адрес пира"
ok "пир создан: 10.77.0.2"

log "Пир применён на интерфейсе (wg show внутри контейнера)"
check_peer_applied() { docker exec "$AGENT_A" wg show wg0 peers | grep -q "$PEER_PUB"; }
wait_for 60 "пир в wg show" check_peer_applied

log "Клиентский конфиг"
CONFIG=$(api GET "/api/v1/wg/peers/$PEER_ID/config")
echo "$CONFIG" | grep -q "Endpoint = $IP_B:51820" || fail "endpoint в конфиге: $CONFIG"
echo "$CONFIG" | grep -q "Address = 10.77.0.2/32" || fail "адрес в конфиге"
ok "конфиг указывает на релей $IP_B:51820"
QR=$(api GET "/api/v1/wg/peers/$PEER_ID/qr" | json "d['dataUrl'][:22]")
[ "$QR" = "data:image/png;base64," ] || fail "QR"
ok "QR выпускается"

log "Релей настроил DNAT до ноды A"
check_dnat() {
  docker exec "$AGENT_B" iptables -t nat -S WG_ADMIN_PRE 2>/dev/null |
    grep -q -- "--dport 51820 .* --to-destination $IP_A:51820"
}
wait_for 60 "правило DNAT на релее" check_dnat

log "IPIP-туннель релея отвечает (проба агента)"
check_link_ok() {
  [ "$(api GET "/api/v1/wg/stats/links/node/$NODE_A_ID" | json "d[0]['status']")" = "ok" ]
}
wait_for 60 "линк релей → нода A: статус ok" check_link_ok

log "Связность нод (агенты пингуют publicHost друг друга раз в минуту)"
check_mesh() {
  api GET /api/v1/wg/stats/mesh |
    json "[c for c in d['cells'] if c['fromNodeId']=='$NODE_A_ID' and c['toNodeId']=='$NODE_B_ID' and c['rttMs'] is not None]" |
    grep -q fromNodeId
}
wait_for 150 "матрица: A → B с RTT" check_mesh

log "Статистика течёт"
check_current() {
  api GET "/api/v1/wg/stats/current/node/$NODE_A_ID" | json "d['nodeId']" | grep -q "$NODE_A_ID"
}
wait_for 30 "live-снимок ноды" check_current
node_transport() { api GET "/api/v1/wg/stats/current/node/$1" | json "d['transport']"; }
check_link() { [ "$(node_transport "$1")" = "link" ]; }
wait_for 30 "агент A на постоянном канале" check_link "$NODE_A_ID"
check_window() {
  [ "$(api GET "/api/v1/wg/stats/window/node/$NODE_A_ID" | json "len(d)")" -ge 2 ]
}
wait_for 30 "ряд скорости ноды копится" check_window
# Счётчики overview кэшируются на 30 с — ждём актуальных значений.
check_overview() {
  [ "$(api GET /api/v1/wg/stats/overview | json "d['nodes']['online']")" -ge 2 ]
}
wait_for 60 "overview: обе ноды online" check_overview

check_metrics() {
  [ "$(api GET "/api/v1/wg/stats/node-metrics?nodeId=$NODE_A_ID" | json "len(d)")" -ge 1 ]
}
wait_for 90 "системные метрики ноды в БД" check_metrics

log "Команда агенту: перезапуск интерфейса"
api POST "/api/v1/wg/interfaces/$IFACE_ID/restart" >/dev/null
check_restarted() {
  api GET "/api/v1/wg/nodes/$NODE_A_ID/logs?lines=200" | json "d['content']" | grep -q "interface-restart" &&
    docker exec "$AGENT_A" wg show wg0 >/dev/null
}
wait_for 60 "агент перезапустил wg0" check_restarted

log "Журнал агента"
LOGS=$(api GET "/api/v1/wg/nodes/$NODE_A_ID/logs?lines=100")
echo "$LOGS" | json "d['content']" | grep -qi "wg0\|конфигурац" || fail "журнал пуст"
ok "журнал получен"

log "Настоящий трафик: клиент → релей (FORWARD DROP, как у Docker) → нода"
# На хостах с Docker политика FORWARD — DROP: DNAT-проброс релея без своих
# разрешающих правил молча режется.
docker exec "$AGENT_B" iptables -P FORWARD DROP
CLIENT="$PROJECT-client"
echo "$CONFIG" | grep -vE "^(DNS|AllowedIPs) " |
  sed "s|^\[Peer\]|[Peer]\nAllowedIPs = 10.77.0.0/24|" > "/tmp/$PROJECT-client.conf"
docker run -d --name "$CLIENT" --network "$NETWORK" --cap-add NET_ADMIN \
  --entrypoint sleep wg-admin-agent:test infinity >/dev/null
docker cp "/tmp/$PROJECT-client.conf" "$CLIENT:/etc/wireguard/wgc.conf"
docker exec "$CLIENT" wg-quick up wgc >/dev/null 2>&1 || fail "клиент: wg-quick up"
check_through_relay() { docker exec "$CLIENT" ping -c 1 -W 2 10.77.0.1 >/dev/null; }
wait_for 30 "клиент пингует ноду через релей" check_through_relay
docker rm -f "$CLIENT" >/dev/null

log "Нода C «только туннель» + пробросы UDP/TCP через IPIP"
# У C свои сервисы — UDP-эхо и TCP-эхо в сетевом пространстве ноды, агент
# держит только конец туннеля. Агент C работает по HTTP-протоколу — запасной
# путь проходит те же сценарии.
NODE_C=$(api POST /api/v1/wg/nodes '{"name":"server-c"}')
NODE_C_ID=$(echo "$NODE_C" | json "d['node']['id']")
NODE_C_KEY=$(echo "$NODE_C" | json "d['agentKey']")
AGENT_C="$PROJECT-agent-c"
docker run -d --name "$AGENT_C" --network "$NETWORK" --restart unless-stopped \
  --cap-add NET_ADMIN -e WG_AGENT_BACKEND_URL=http://api:8181 \
  -e WG_AGENT_TRANSPORT=http -e WG_AGENT_KEY="$NODE_C_KEY" wg-admin-agent:test >/dev/null
IP_C=$(docker inspect -f '{{(index .NetworkSettings.Networks "'"$NETWORK"'").IPAddress}}' "$AGENT_C")
api PATCH "/api/v1/wg/nodes/$NODE_C_ID" "{\"publicHost\":\"$IP_C\"}" >/dev/null
wait_for 60 "агент ноды C online" check_online "$NODE_C_ID"
check_http() { [ "$(node_transport "$NODE_C_ID")" = "http" ]; }
wait_for 30 "агент C по HTTP-протоколу" check_http
in_netns udp-echo "$AGENT_C" "const s=require('dgram').createSocket('udp4');s.on('message',(m,r)=>s.send('pong:'+m,r.port,r.address));s.bind(5000)"
in_netns tcp-echo "$AGENT_C" "require('net').createServer(c=>c.on('data',d=>c.end('pong:'+d))).listen(8443)"

UDP_FWD=$(api POST /api/v1/wg/forwards "{\"name\":\"wg-server\",\"relayNodeId\":\"$NODE_B_ID\",\"protocol\":\"udp\",\"listenPort\":51950,\"targetNodeId\":\"$NODE_C_ID\",\"targetPort\":5000,\"path\":\"ipip\"}" | json "d['id']")
TCP_FWD=$(api POST /api/v1/wg/forwards "{\"name\":\"socks-tls\",\"relayNodeId\":\"$NODE_B_ID\",\"protocol\":\"tcp\",\"listenPort\":8443,\"targetNodeId\":\"$NODE_C_ID\",\"targetPort\":8443,\"path\":\"ipip\"}" | json "d['id']")

CLIENT_X="$PROJECT-client-x"
docker run -d --name "$CLIENT_X" --network "$NETWORK" "$NODE_IMAGE" \
  sleep infinity >/dev/null
udp_echo() {
  docker exec "$CLIENT_X" node -e "const s=require('dgram').createSocket('udp4');s.on('message',m=>{console.log(m+'');process.exit(0)});s.send('x',51950,'$IP_B');setTimeout(()=>process.exit(1),2000)" | grep -q "pong:x"
}
tcp_echo() {
  docker exec "$CLIENT_X" node -e "const c=require('net').connect(8443,'$IP_B',()=>c.write('y'));c.on('data',d=>{console.log(d+'');process.exit(0)});setTimeout(()=>process.exit(1),2000)" | grep -q "pong:y"
}
route_of() { api GET "/api/v1/wg/forwards/$1" | json "d['activeRoute']"; }
check_both() { udp_echo && tcp_echo; }
wait_for 60 "UDP и TCP через туннель релея (FORWARD DROP)" check_both
check_tunnel_route() { [ "$(route_of "$UDP_FWD")" = "tunnel" ]; }
wait_for 30 "активный маршрут: туннель" check_tunnel_route

log "Аварийный путь: туннель лёг — релей сам уходит напрямую и возвращается"
C_TUNNEL=$(docker exec "$AGENT_C" ip -o link show type ipip | grep -o "wgt[0-9]*" | head -1)
docker exec "$AGENT_C" ip link set "$C_TUNNEL" down
check_direct_route() { [ "$(route_of "$UDP_FWD")" = "direct" ]; }
wait_for 90 "маршрут переключился на прямой" check_direct_route
wait_for 30 "UDP и TCP работают по прямому пути" check_both
docker exec "$AGENT_C" ip link set "$C_TUNNEL" up
wait_for 90 "маршрут вернулся в туннель" check_tunnel_route
wait_for 30 "UDP и TCP снова через туннель" check_both

log "Ручное переключение маршрута из админки"
api PATCH "/api/v1/wg/forwards/$UDP_FWD" '{"route":"direct"}' >/dev/null
wait_for 30 "принудительно напрямую" check_direct_route
wait_for 30 "UDP работает принудительно напрямую" udp_echo
api PATCH "/api/v1/wg/forwards/$UDP_FWD" '{"route":"auto"}' >/dev/null
wait_for 30 "снова auto → туннель" check_tunnel_route

log "SOCKS5 через mTLS на ноде C, снаружи — через TCP-проброс релея"
SOCKS=$(api POST /api/v1/wg/socks "{\"name\":\"tg\",\"nodeId\":\"$NODE_C_ID\",\"listenPort\":8444,\"clientHost\":\"$IP_B\",\"clientPort\":8445}")
SOCKS_ID=$(echo "$SOCKS" | json "d['id']")
SOCKS_PASS=$(api POST "/api/v1/wg/socks/$SOCKS_ID/users" '{"username":"tg"}' | json "d['password']")
SOCKS_CLIENT_ID=$(api POST "/api/v1/wg/socks/$SOCKS_ID/clients" '{"name":"laptop"}' | json "d['id']")
SOCKS_FWD=$(api POST /api/v1/wg/forwards "{\"name\":\"socks\",\"relayNodeId\":\"$NODE_B_ID\",\"protocol\":\"tcp\",\"listenPort\":8445,\"targetNodeId\":\"$NODE_C_ID\",\"targetPort\":8444,\"path\":\"ipip\"}" | json "d['id']")
SMOKE_TMP=$(mktemp -d)
curl -fsS -o "$SMOKE_TMP/mac.zip" -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/wg/socks/$SOCKS_ID/clients/$SOCKS_CLIENT_ID/mac"
if ! unzip -o -q "$SMOKE_TMP/mac.zip" -d "$SMOKE_TMP" || ! bash -n "$SMOKE_TMP"/tg-mac/install.sh; then
  fail "архив клиента для Mac битый"
fi
grep -q "connect = $IP_B:8445" "$SMOKE_TMP"/tg-mac/install.sh || fail "архив ведёт не на релей"
ok "архив клиента для Mac: install.sh на адрес релея"
# Клиент как stunnel + Telegram: сертификаты из архива для Mac, mTLS до релея,
# SOCKS5 с логином, HTTP к api по имени.
cat >"$SMOKE_TMP/socks-client.js" <<'JS'
const tls = require("tls");
const fs = require("fs");
const pem = name => fs.readFileSync(`/tmp/socks/${name}`, "utf8");
const [user, pass] = [process.env.SOCKS_USER, process.env.SOCKS_PASS];
const s = tls.connect({ host: process.env.SOCKS_HOST, port: Number(process.env.SOCKS_PORT),
  ca: pem("ca.pem"), cert: pem("client.pem"), key: pem("client-key.pem"),
  checkServerIdentity: () => undefined });
let step = 0, buf = Buffer.alloc(0);
const host = Buffer.from("api");
s.on("secureConnect", () => s.write(Buffer.from([5, 1, 2])));
s.on("data", d => {
  buf = Buffer.concat([buf, d]);
  if (step === 0 && buf.length >= 2) {
    buf = buf.subarray(2); step = 1;
    s.write(Buffer.concat([Buffer.from([1, user.length]), Buffer.from(user),
      Buffer.from([pass.length]), Buffer.from(pass)]));
  } else if (step === 1 && buf.length >= 2) {
    if (buf[1] !== 0) process.exit(2);
    buf = buf.subarray(2); step = 2;
    s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([0x1f, 0xf5])]));
  } else if (step === 2 && buf.length >= 10) {
    if (buf[1] !== 0) process.exit(3);
    buf = buf.subarray(10); step = 3;
    s.write("GET /ping HTTP/1.0\r\nHost: api\r\n\r\n");
  } else if (step === 3 && /HTTP\/1\.[01] 200/.test(buf.toString())) {
    console.log("socks-ok"); process.exit(0);
  }
});
s.on("error", () => process.exit(4));
s.on("close", () => process.exit(5));
setTimeout(() => process.exit(6), 5000);
JS
docker cp "$SMOKE_TMP/socks-client.js" "$CLIENT_X":/tmp/socks-client.js
docker cp "$SMOKE_TMP/tg-mac" "$CLIENT_X":/tmp/socks
socks_http() {
  docker exec -e SOCKS_USER=tg -e SOCKS_PASS="$SOCKS_PASS" -e SOCKS_HOST="$IP_B" -e SOCKS_PORT=8445 "$CLIENT_X" \
    node /tmp/socks-client.js | grep -q socks-ok
}
wait_for 60 "HTTP через SOCKS5 по mTLS: релей → туннель → агент ноды C" socks_http
socks_live() {
  [ "$(api GET "/api/v1/wg/socks/$SOCKS_ID" | json "(d['live'] or {}).get('rxBytes', 0) > 0")" = "True" ]
}
wait_for 60 "трафик прокси виден в админке" socks_live
api POST "/api/v1/wg/socks/$SOCKS_ID/clients/$SOCKS_CLIENT_ID/revoke" >/dev/null
socks_denied() { ! socks_http; }
wait_for 60 "отозванный сертификат больше не пускают" socks_denied
api DELETE "/api/v1/wg/forwards/$SOCKS_FWD" >/dev/null
api DELETE "/api/v1/wg/socks/$SOCKS_ID" >/dev/null
socks_closed() {
  docker exec "$CLIENT_X" node -e "require('net').connect(8444,'$IP_C').on('connect',()=>process.exit(1)).on('error',()=>process.exit(0))"
}
wait_for 60 "прокси удалён — порт 8444 на ноде закрыт" socks_closed
rm -rf "$SMOKE_TMP"

docker rm -f "$CLIENT_X" >/dev/null
api DELETE "/api/v1/wg/forwards/$UDP_FWD" >/dev/null
api DELETE "/api/v1/wg/forwards/$TCP_FWD" >/dev/null

log "Реплики интерфейса: основная копия легла — релей переводит клиента на реплику"
NODE_D=$(api POST /api/v1/wg/nodes '{"name":"replica-d"}')
NODE_D_ID=$(echo "$NODE_D" | json "d['node']['id']")
NODE_D_KEY=$(echo "$NODE_D" | json "d['agentKey']")
AGENT_D="$PROJECT-agent-d"
docker run -d --name "$AGENT_D" --network "$NETWORK" --restart unless-stopped \
  --cap-add NET_ADMIN -e WG_AGENT_BACKEND_URL=http://api:8181 \
  -e WG_AGENT_KEY="$NODE_D_KEY" wg-admin-agent:test >/dev/null
IP_D=$(docker inspect -f '{{(index .NetworkSettings.Networks "'"$NETWORK"'").IPAddress}}' "$AGENT_D")
api PATCH "/api/v1/wg/nodes/$NODE_D_ID" "{\"publicHost\":\"$IP_D\"}" >/dev/null
wait_for 60 "агент ноды D online" check_online "$NODE_D_ID"
api POST "/api/v1/wg/interfaces/$IFACE_ID/replicas" "{\"nodeId\":\"$NODE_D_ID\"}" >/dev/null
check_replica_up() { docker exec "$AGENT_D" wg show wg0 peers | grep -q "$PEER_PUB"; }
wait_for 60 "копия wg0 с тем же пиром на ноде D" check_replica_up

CLIENT_R="$PROJECT-client-r"
docker run -d --name "$CLIENT_R" --network "$NETWORK" --cap-add NET_ADMIN \
  --entrypoint sleep wg-admin-agent:test infinity >/dev/null
docker cp "/tmp/$PROJECT-client.conf" "$CLIENT_R:/etc/wireguard/wgc.conf"
docker exec "$CLIENT_R" wg-quick up wgc >/dev/null 2>&1 || fail "клиент: wg-quick up"
client_ping() { docker exec "$CLIENT_R" ping -c 1 -W 2 10.77.0.1 >/dev/null; }
serving_of() { api GET "/api/v1/wg/interfaces/$IFACE_ID" | json "d['servingNodeId']"; }
wait_for 30 "клиент через релей на основной копии" client_ping
check_serving_a() { [ "$(serving_of)" = "$NODE_A_ID" ]; }
wait_for 30 "обслуживает основная копия (A)" check_serving_a

# «VPS A умер»: весь входящий трафик ноды A отбрасывается.
docker exec "$AGENT_A" iptables -I INPUT 1 -j DROP
check_serving_d() { [ "$(serving_of)" = "$NODE_D_ID" ]; }
wait_for 90 "релей перевёл трафик на реплику D" check_serving_d
if ! (wait_for 60 "клиент продолжает работать через реплику (тот же ключ)" client_ping); then
  echo "--- релей B: журнал агента"; docker logs --tail 30 "$AGENT_B" 2>&1 | grep -vE "Статистика"
  echo "--- релей B: conntrack udp/51820"; docker exec "$AGENT_B" conntrack -L -p udp --dport 51820 2>&1 | head
  echo "--- релей B: nat"; docker exec "$AGENT_B" iptables -t nat -S WG_ADMIN_PRE; docker exec "$AGENT_B" iptables -t nat -S WG_ADMIN_POST
  echo "--- релей B: FWD"; docker exec "$AGENT_B" iptables -S WG_ADMIN_FWD
  echo "--- D: wg show"; docker exec "$AGENT_D" wg show
  echo "--- клиент: wg show"; docker exec "$CLIENT_R" wg show
  fail "клиент не продолжил работу через реплику"
fi
docker exec "$AGENT_A" iptables -D INPUT 1

log "Ручное закрепление копии из админки"
api PATCH "/api/v1/wg/interfaces/$IFACE_ID" "{\"activeReplicaNodeId\":\"$NODE_A_ID\"}" >/dev/null
wait_for 60 "закреплено на A" check_serving_a
wait_for 60 "клиент работает через закреплённую копию" client_ping
api PATCH "/api/v1/wg/interfaces/$IFACE_ID" '{"activeReplicaNodeId":null}' >/dev/null
docker rm -f "$CLIENT_R" >/dev/null
api DELETE "/api/v1/wg/interfaces/$IFACE_ID/replicas/$NODE_D_ID" >/dev/null
docker rm -f "$AGENT_D" >/dev/null

log "Выключение пира применяется агентом"
tunnel_ifindex() { docker exec "$AGENT_A" ip -o link show type ipip | grep wgt | cut -d: -f1; }
TUNNEL_BEFORE=$(tunnel_ifindex)
api POST "/api/v1/wg/peers/$PEER_ID/disable" >/dev/null
check_peer_removed() { ! docker exec "$AGENT_A" wg show wg0 peers | grep -q "$PEER_PUB"; }
wait_for 60 "пир снят с интерфейса" check_peer_removed
# Применение новой версии не должно пересоздавать неизменный туннель.
if [ -z "$TUNNEL_BEFORE" ] || [ "$(tunnel_ifindex)" != "$TUNNEL_BEFORE" ]; then
  fail "IPIP-туннель пересоздан при применении конфигурации ($TUNNEL_BEFORE → $(tunnel_ifindex))"
fi
ok "туннель не пересоздавался"

log "Защита: порт на релее занят чужим процессом"
in_netns busy-port "$AGENT_B" "require('dgram').createSocket('udp4').bind(51829); setInterval(() => {}, 1e9)"
sleep 1
FOREIGN=$(curl -sS -X POST "$BASE_URL/api/v1/wg/interfaces" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"nodeId\":\"$NODE_A_ID\",\"name\":\"wg9\",\"listenPort\":51829,\"addressCidr\":\"10.79.0.1/24\",\"endpointId\":\"$ENDPOINT_ID\"}")
if echo "$FOREIGN" | grep -q "WG_IFACE_RELAY_PORT_BUSY"; then
  ok "бэкенд отклонил: порт занят на хосте релея (по отчёту агента)"
else
  check_refused() {
    api GET "/api/v1/wg/nodes/$NODE_B_ID" | json "d['applyError'] or ''" | grep -q "51829"
  }
  wait_for 60 "агент релея отказался ставить проброс на занятый порт" check_refused
  api DELETE "/api/v1/wg/interfaces/$(echo "$FOREIGN" | json "d['id']")" >/dev/null
fi
docker exec "$AGENT_B" iptables -t nat -S WG_ADMIN_PRE | grep -q -- "--dport 51829" &&
  fail "проброс на чужой порт 51829 установлен"
ok "проброс на чужой порт не установлен"
docker rm -f "$PROJECT-ns-busy-port" >/dev/null

log "Откат командой cleanup: только своё"
docker exec "$AGENT_B" ip tunnel add foreign-tun mode ipip remote 203.0.113.99 local "$IP_B" ttl 64
docker exec "$AGENT_B" wg-admin-agent cleanup
docker exec "$AGENT_B" iptables -t nat -S 2>/dev/null | grep -q WG_ADMIN && fail "цепочки WG_ADMIN остались"
docker exec "$AGENT_B" ip -o link show type ipip | grep -q wgt && fail "туннели агента остались"
docker exec "$AGENT_B" ip -o link show foreign-tun >/dev/null || fail "cleanup тронул чужой туннель"
docker exec "$AGENT_B" ip tunnel del foreign-tun
ok "cleanup убрал цепочки и туннели агента, чужой туннель на месте"
# Вернуть релей к рабочему состоянию: перезапуск агента поднимет конфигурацию.
docker restart "$AGENT_B" >/dev/null
wait_for 60 "правило DNAT на релее после перезапуска" check_dnat

check_iface_restored() { docker exec "$AGENT_A" wg show wg0 >/dev/null; }

log "Обновление агента бинарём с бэкенда (без переустановки)"
RELEASE=$(api GET /api/v1/wg/agent/release)
RELEASE_VERSION=$(echo "$RELEASE" | json "d['version']")
ARCH_A=$(api GET "/api/v1/wg/nodes/$NODE_A_ID" | json "d['osInfo']['arch']")
RELEASE_HASH=$(echo "$RELEASE" | json "d['hashes'].get('$ARCH_A')")
if [ -z "$RELEASE_HASH" ] || [ "$RELEASE_HASH" = "None" ]; then
  fail "бэкенд не раздаёт бинарь агента ($ARCH_A)"
fi
[ "$(docker exec "$AGENT_A" sha256sum /usr/local/bin/wg-admin-agent | cut -d' ' -f1)" != "$RELEASE_HASH" ] ||
  fail "бинарь в образе агента совпадает с релизом — соберите образ с AGENT_VERSION (см. шапку)"
api POST "/api/v1/wg/agent/nodes/$NODE_A_ID/update" | json "d['payload']['hash']" | grep -qx "$RELEASE_HASH" ||
  fail "команда обновления без sha256 релиза"
check_updated() {
  local node
  node=$(api GET "/api/v1/wg/nodes/$NODE_A_ID")
  [ "$(echo "$node" | json "d['agentCodeHash']")" = "$RELEASE_HASH" ] &&
    [ "$(echo "$node" | json "d['agentVersion']")" = "$RELEASE_VERSION" ] &&
    [ "$(echo "$node" | json "d['status']")" = "online" ] &&
    ! docker exec "$AGENT_A" test -f /etc/wireguard/.agent-update
}
wait_for 90 "агент перезапущен на новом бинаре и на связи" check_updated
docker exec "$AGENT_A" test -x /usr/local/bin/wg-admin-agent.prev || fail "прежний бинарь для отката не сохранён"
wait_for 60 "wg0 поднят после обновления" check_iface_restored

log "Автономный старт: бэкенд недоступен, агенты перезапущены"
# Рестарт контейнера пересоздаёт его сетевое пространство — как перезагрузка
# хоста: интерфейсы и правила пропадают, агент поднимает их из сохранённой
# конфигурации.
$COMPOSE stop api >/dev/null
docker restart "$AGENT_A" "$AGENT_B" >/dev/null
wait_for 60 "wg0 поднят без бэкенда" check_iface_restored
wait_for 60 "DNAT на релее восстановлен без бэкенда" check_dnat
$COMPOSE start api >/dev/null
wait_for 90 "API снова отвечает" curl -fsS "$BASE_URL/ping"
wait_for 60 "нода A снова online" check_online "$NODE_A_ID"
wait_for 60 "агент A переподключился к каналу" check_link "$NODE_A_ID"

log "Остановка контейнера откатывает созданное агентом"
STOP_STARTED=$(date +%s)
docker stop -t 30 "$AGENT_B" >/dev/null
STOP_TOOK=$(( $(date +%s) - STOP_STARTED ))
# Журнал — в переменную: `docker logs | grep -q` под pipefail падает от
# SIGPIPE, когда grep выходит на первом совпадении.
AGENT_B_LOGS=$(docker logs "$AGENT_B" 2>&1)
if ! grep -q "Созданное агентом на хосте откачено" <<<"$AGENT_B_LOGS"; then
  tail -15 <<<"$AGENT_B_LOGS"
  fail "SIGTERM не запустил откат (остановка заняла ${STOP_TOOK} с)"
fi
ok "docker stop → откат выполнен"
check_offline() { [ "$(node_status "$NODE_B_ID")" = "offline" ]; }
wait_for 60 "нода B offline вскоре после разрыва канала" check_offline

printf '\n\033[1;32m═══ Интеграционный тест пройден ═══\033[0m\n'
