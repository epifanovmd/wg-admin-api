#!/usr/bin/env bash
# Агент на этой машине к бэкенду из .env.development: связь, настройки воркеров, метрики и
# события держит агент (github.com/epifanovmd/agent); воркеры wg (в режиме имитации) и socks.
# Настройки агента — agent/local/agent.yaml. Воркеры проекта для узлов собирает agent/release.sh.
#
#   agent/dev.sh run              агент на переднем плане (Ctrl+C — остановка агента и воркеров)
#   agent/dev.sh start            то же в фоне
#   agent/dev.sh stop [--force]   остановить агента и воркеры; --force — сразу (SIGKILL)
#   agent/dev.sh status           запущен ли
#   agent/dev.sh logs             журнал фонового агента
#   agent/dev.sh check            проверить настройки агента (agent config check)
#
# Программа агента — AGENT_BIN, иначе agent/dist/agent-<версия>/agent-<os>-<arch> (версия — agent-sdk
# из package.json); её нет — скачивается с GitHub (agent/fetch-agent.sh).
# Воркеры — WG_WORKER_BIN и SOCKS_WORKER_BIN, иначе сборки под эту машину из agent/release или
# agent/dist, иначе сборка в контейнере (scripts/go-agent.sh build <os> <arch>).
#
# Регистрация — AGENT_BOOTSTRAP_TOKEN из env-файла (тот же, что у бэкенда; не короче 32
# символов), адрес — http://localhost:$SERVER_PORT. Имя — AGENT_NAME (по умолчанию dev-$USER),
# метка nodeId — AGENT_NODE_ID (если задана). Воркер wg — WG_DRY_RUN=1 (на macOS всегда; на
# Linux WG_DRY_RUN=0 — настоящая настройка узла, нужен root). Другой env-файл — ENV_FILE=…,
# второй агент — AGENT_DIR=.agent-2 AGENT_NAME=dev-2. Данные агента (ключ, очередь, настройки
# воркеров) — <AGENT_DIR>/data: удалить их — агент зарегистрируется заново.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.development}"
RUN_DIR="${AGENT_DIR:-.agent}"
case "$RUN_DIR" in /*) ;; *) RUN_DIR="$ROOT/$RUN_DIR" ;; esac
PID_FILE="$RUN_DIR/agent.pid"
LOG_FILE="$RUN_DIR/agent.log"
STOP_TIMEOUT="${STOP_TIMEOUT:-60}"
RELEASE_DIR=agent/release

env_value() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
  fi
}

running_pid() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then cat "$PID_FILE"; fi
}

platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
  echo "$os-$arch"
}

# Версия агента для разработки — версия agent-sdk из package.json.
agent_version() {
  node -p "((require('./package.json').dependencies || {})['agent-sdk'] || '').match(/agent-sdk-([^/]+)\\.tgz$/)?.[1] || ''"
}

# Программа агента: первая найденная; нет — скачать выпуск agent-sdk с GitHub.
binary() {
  local file candidate version
  file="agent-$(platform)"
  version="$(agent_version)"
  for candidate in "${AGENT_BIN:-}" "$RUN_DIR/bin/agent" "agent/dist/agent-$version/$file"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  if [ -n "$version" ] && agent/fetch-agent.sh "$version" >&2 && [ -x "agent/dist/agent-$version/$file" ]; then
    echo "agent/dist/agent-$version/$file"
    return
  fi
  cat >&2 <<HINT
Нет программы агента для $(platform): agent/fetch-agent.sh (выпуск с GitHub в agent/dist)
или укажите свою: AGENT_BIN=/путь/к/agent agent/dev.sh run
HINT
  exit 1
}

# Сборка воркера $1 под эту машину (абсолютный путь): из выпуска, из agent/dist или собрать.
worker_binary() {
  local name="$1" override="$2" version file candidate p
  version="$(tr -d '[:space:]' <"agent/workers/$name/VERSION")"
  p="$(platform)"
  file="$name-$version-$p"
  for candidate in "$override" "$RELEASE_DIR/$file" "agent/dist/$file"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      (cd "$(dirname "$candidate")" && echo "$(pwd)/$(basename "$candidate")")
      return
    fi
  done
  echo "Нет сборки $file — собираю (scripts/go-agent.sh build ${p%-*} ${p#*-})" >&2
  scripts/go-agent.sh build "${p%-*}" "${p#*-}" >&2
  echo "$ROOT/agent/dist/$file"
}

prepare() {
  BIN="$(binary)"
  local token="${AGENT_BOOTSTRAP_TOKEN:-$(env_value AGENT_BOOTSTRAP_TOKEN)}"
  if [ "${#token}" -lt 32 ]; then
    echo "Нет AGENT_BOOTSTRAP_TOKEN в $ENV_FILE (не короче 32 символов; тот же — у бэкенда)" >&2
    exit 1
  fi
  mkdir -p "$RUN_DIR/data"
  export AGENT_BOOTSTRAP_TOKEN="$token"
  SERVER_PORT="${SERVER_PORT:-$(env_value SERVER_PORT)}"
  export SERVER_PORT="${SERVER_PORT:-8181}"
  export AGENT_DATA_DIR="$RUN_DIR/data"
  export AGENT_NAME="${AGENT_NAME:-dev-${USER:-dev}}"
  export AGENT_CONFIG="${AGENT_CONFIG:-$ROOT/agent/local/agent.yaml}"
  # Метки из переменной агент добавляет к меткам из файла; пустой nodeId не передаётся.
  if [ -n "${AGENT_NODE_ID:-}" ]; then
    export AGENT_LABELS="${AGENT_LABELS:+$AGENT_LABELS,}nodeId=$AGENT_NODE_ID"
  fi

  WG_WORKER_BIN="$(worker_binary wg "${WG_WORKER_BIN:-}")"
  SOCKS_WORKER_BIN="$(worker_binary socks "${SOCKS_WORKER_BIN:-}")"
  export WG_WORKER_BIN SOCKS_WORKER_BIN
  if [ "$(uname -s)" != Linux ]; then
    export WG_DRY_RUN=1
  else
    export WG_DRY_RUN="${WG_DRY_RUN:-1}"
  fi
  if [ "$WG_DRY_RUN" = 1 ]; then
    export WG_CONFIG_DIR="${WG_CONFIG_DIR:-$RUN_DIR/wg/wireguard}"
    export WG_STATE_DIR="${WG_STATE_DIR:-$RUN_DIR/wg/state}"
  else
    export WG_CONFIG_DIR="${WG_CONFIG_DIR:-/etc/wireguard}"
    export WG_STATE_DIR="${WG_STATE_DIR:-/var/lib/wg-admin}"
  fi
}

# Воркеры переживают остановку агента (lifecycle.onAgentStop: keep) — здесь их тоже останавливаем.
stop_workers() {
  "$BIN" stop-workers -config "$AGENT_CONFIG" || true
}

case "${1:-}" in
  run)
    prepare
    trap 'kill -TERM "$child" 2>/dev/null || true' INT TERM
    "$BIN" run -config "$AGENT_CONFIG" &
    child=$!
    wait "$child" || true
    wait "$child" 2>/dev/null || true
    stop_workers
    ;;
  start)
    if [ -n "$(running_pid)" ]; then
      echo "Уже запущен (pid $(running_pid))"
      exit 0
    fi
    prepare
    nohup "$BIN" run -config "$AGENT_CONFIG" >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    echo "Запущен (pid $!), журнал — agent/dev.sh logs"
    ;;
  stop)
    prepare
    pid="$(running_pid)"
    if [ -n "$pid" ]; then
      if [ "${2:-}" = "--force" ]; then
        kill -KILL "$pid" 2>/dev/null || true
      else
        kill -TERM "$pid" 2>/dev/null || true
        for _ in $(seq 1 "$STOP_TIMEOUT"); do
          kill -0 "$pid" 2>/dev/null || break
          sleep 1
        done
      fi
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "Агент ещё останавливается (pid $pid); сразу — agent/dev.sh stop --force"
      exit 1
    fi
    rm -f "$PID_FILE"
    stop_workers
    echo "Остановлен"
    ;;
  status)
    pid="$(running_pid)"
    if [ -n "$pid" ]; then echo "Работает (pid $pid)"; else echo "Не запущен"; fi
    ;;
  check)
    prepare
    exec "$BIN" config check -config "$AGENT_CONFIG"
    ;;
  logs)
    mkdir -p "$RUN_DIR"
    touch "$LOG_FILE"
    exec tail -n 200 -f "$LOG_FILE"
    ;;
  *)
    echo "использование: $0 run | start | stop [--force] | status | logs | check" >&2
    exit 2
    ;;
esac
