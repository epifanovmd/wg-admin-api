#!/bin/sh
# Агент на машине разработчика: программа agent/agent версии AGENT_VERSION (.env*)
# (нет — скачивается из релиза агента со сверкой sha256), порт API и токен регистрации — из
# .env.development (тот же AGENT_BOOTSTRAP_TOKEN, что у API), настройки — agent/agent.yaml.
#
#   yarn agent [команда агента …]   без команды — agent run на переднем плане (Ctrl+C — остановить
#                                   вместе с воркерами); например, yarn agent status,
#                                   yarn agent config check
#   yarn agent:fetch                программа агента, сборки агента и install.sh той же версии в
#                                   agent/dist/v<версия> (сквозные тесты; AGENT_PLATFORMS="linux-amd64 …")
#   yarn agent:pack                 архивы для узлов, сборки воркеров и установщик агента
#                                   (install.sh той же версии) → agent/bundle
#
# Другой env-файл — ENV_FILE=…, второй агент — AGENT_DIR=.agent-2 AGENT_NAME=dev-2 (свои ключ и
# данные), привязать к ноде — AGENT_NODE_ID=<id> (метка nodeId). Данные агента — <AGENT_DIR>/data;
# удалить их — агент зарегистрируется заново и привяжется к ноде по метке или имени.
# Каталог сборок вместо релиза на GitHub — AGENT_RELEASES_URL.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
AGENT="$ROOT/agent/agent"

die() {
  echo "agent: $*" >&2
  exit 1
}

# env_value ИМЯ — значение переменной: окружение, затем .env.development, .env, .env.example.
env_value() {
  eval "v=\${$1:-}"
  for f in .env.development .env .env.example; do
    [ -n "$v" ] && break
    [ -f "$ROOT/$f" ] && v=$(sed -n "s/^$1=//p" "$ROOT/$f" | tail -n 1)
  done
  printf '%s' "$v"
}

# Версия агента — AGENT_VERSION (окружение или файлы .env*).
VERSION=$(env_value AGENT_VERSION)
[ -n "$VERSION" ] || die "не задана AGENT_VERSION (.env.example)"
BASE=${AGENT_RELEASES_URL:-https://github.com/epifanovmd/agent/releases/download/v$VERSION}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# Записи manifest.json по одной в строке (записи плоские; без jq).
entries() {
  tr -d '\n\r\t ' <"$1" | tr '{' '\n' | grep '"sha256"'
}
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

# get FILE SHA256 DEST — скачать сборку из каталога релиза со сверкой sha256 (верная уже — не качать).
get() {
  if [ -f "$3" ] && [ "$(sha256 "$3")" = "$2" ]; then return; fi
  curl -fsSL "$BASE/$1" -o "$3.new" || die "$1 не скачан из $BASE"
  [ "$(sha256 "$3.new")" = "$2" ] || { rm -f "$3.new"; die "$1: sha256 не совпадает с manifest.json"; }
  chmod 0755 "$3.new"
  mv "$3.new" "$3"
  echo "$1" >&2
}

platform() {
  case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
  echo "$os-$arch"
}

# Программа агента версии AGENT_VERSION: нет или другая версия — из релиза.
ensure_agent() {
  [ -x "$AGENT" ] && [ "$("$AGENT" version 2>/dev/null | head -n 1)" = "$VERSION" ] && return
  tmp=$(mktemp)
  curl -fsSL "$BASE/manifest.json" -o "$tmp" || die "нет $BASE/manifest.json"
  p=$(platform)
  entry=$(entries "$tmp" | grep -v '"name":' | grep "\"os\":\"${p%-*}\"" | grep "\"arch\":\"${p#*-}\"" | head -n 1) || true
  rm -f "$tmp"
  [ -n "$entry" ] || die "в релизе агента $VERSION нет сборки под $p"
  echo "Программа агента $VERSION ($p) — в agent/agent" >&2
  get "$(field "$entry" file)" "$(field "$entry" sha256 | tr 'A-F' 'a-f')" "$AGENT"
}

# Сборки агента той же версии в agent/dist/v<версия> — для сквозных тестов.
fetch_dist() {
  out="$ROOT/agent/dist/v$VERSION"
  mkdir -p "$out"
  curl -fsSL "$BASE/manifest.json" -o "$out/manifest.json.new" || die "нет $BASE/manifest.json"
  got=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$out/manifest.json.new" | head -n 1)
  [ "$got" = "$VERSION" ] || die "в $BASE версия $got, ожидалась $VERSION"
  entries "$out/manifest.json.new" | while IFS= read -r e; do
    p="$(field "$e" os)-$(field "$e" arch)"
    case " ${AGENT_PLATFORMS:-$p} " in *" $p "*) ;; *) continue ;; esac
    file=$(field "$e" file)
    get "$file" "$(field "$e" sha256 | tr 'A-F' 'a-f')" "$out/$file"
  done
  mv "$out/manifest.json.new" "$out/manifest.json"
  # Установщик агента той же версии (его раздаёт API вместе с архивами).
  curl -fsSL "$BASE/install.sh" -o "$out/install.sh" || die "нет $BASE/install.sh"
  echo "$out"
}

# Окружение агента: адрес и токен API — из env-файла, имя и каталог данных этой машины.
agent_env() {
  env_file="$ROOT/${ENV_FILE:-.env.development}"
  value() { [ -f "$env_file" ] && sed -n "s/^$1=//p" "$env_file" | tail -n 1; }
  AGENT_BOOTSTRAP_TOKEN=${AGENT_BOOTSTRAP_TOKEN:-$(value AGENT_BOOTSTRAP_TOKEN)}
  [ -n "$AGENT_BOOTSTRAP_TOKEN" ] || die "нет AGENT_BOOTSTRAP_TOKEN в $env_file (не короче 32 символов; тот же — у API)"
  SERVER_PORT=${SERVER_PORT:-$(value SERVER_PORT)}
  SERVER_PORT=${SERVER_PORT:-8181}
  AGENT_NAME=${AGENT_NAME:-dev-${USER:-dev}}
  if [ -n "${AGENT_NODE_ID:-}" ]; then
    AGENT_LABELS="${AGENT_LABELS:+$AGENT_LABELS,}nodeId=$AGENT_NODE_ID"
    export AGENT_LABELS
  fi
  AGENT_DATA_DIR="$ROOT/${AGENT_DIR:-.agent}/data"
  mkdir -p "$AGENT_DATA_DIR"
  export AGENT_BOOTSTRAP_TOKEN SERVER_PORT AGENT_NAME AGENT_DATA_DIR
}

cmd=${1:-run}
[ $# -eq 0 ] || shift
case "$cmd" in
  fetch)
    fetch_dist
    ensure_agent
    ;;
  pack)
    ensure_agent
    out="$ROOT/agent/bundle"
    rm -rf "$out"
    "$AGENT" pack --env prod --out "$out" --release-out "$out/release" "$@"
    # Установщик агента: API раздаёт его вместе с архивами (bundle/install.sh).
    curl -fsSL "$BASE/install.sh" -o "$out/install.sh" || die "нет $BASE/install.sh"
    ;;
  run)
    ensure_agent
    agent_env
    # Воркеры переживают остановку агента — их тоже останавливаем.
    "$AGENT" run "$@" &
    pid=$!
    trap 'kill -TERM "$pid" 2>/dev/null || true' INT TERM
    code=0
    wait "$pid" || code=$?
    wait "$pid" 2>/dev/null || true
    "$AGENT" stop-workers || true
    exit "$code"
    ;;
  *)
    ensure_agent
    agent_env
    exec "$AGENT" "$cmd" "$@"
    ;;
esac
