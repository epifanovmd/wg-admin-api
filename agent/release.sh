#!/usr/bin/env bash
# Воркеры проекта для узлов — каталог agent/release (другой — RELEASE_OUT=…): бэкенд раздаёт его
# (AGENT_RELEASES_DIR) вместе с агентом и netprobe из выпусков GitHub (AGENT_RELEASES_GITHUB).
# Агента здесь нет: его берёт бэкенд, пересобирать проект ради новой версии агента не нужно.
#
#   1. Воркеры wg и socks (agent/workers/<имя>, версия — его файл VERSION) под linux и darwin ×
#      amd64 и arm64: <имя>-<версия>-<os>-<arch>. Готовые сборки — каталогом WORKERS_PREBUILT=…,
#      иначе сборка: Go на машине, без него — в контейнере golang (scripts/go-agent.sh).
#   2. manifest.json — утилитой agent-release (`manifest DIR VERSION --worker NAME=VERSION,…`, без
#      сборок агента: artifacts пустой; VERSION — версия проекта из package.json):
#      AGENT_RELEASE_TOOL (готовая программа), иначе `go run …/cmd/agent-release@v<версия agent-sdk>`
#      — Go на машине или контейнер golang. AGENT_SIGNING_KEY — закрытый ключ проекта
#      (`agent-release keygen`): им подписаны воркеры; бэкенду — AGENT_UPDATE_PUBLIC_KEY этой пары.
#      Без ключа воркеры не подписаны: установка сверяет их sha256, а обновление воркера с бэкенда
#      агент не примет (UPDATE_NOT_VERIFIED).
#
# Нужны bash и node; Go или Docker — если нет WORKERS_PREBUILT и AGENT_RELEASE_TOOL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${RELEASE_OUT:-agent/release}"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac
REPO=github.com/epifanovmd/agent
WORKERS="wg socks"
PLATFORMS="linux-amd64 linux-arm64 darwin-amd64 darwin-arm64"
# Срок остановки воркера (SIGTERM → SIGKILL) в agent.yaml, который пишет установщик.
STOP_TIMEOUT=30s
# Версия Go — toolchain из agent/go.mod: воркеры собираются Go с исправлениями.
GO_VERSION="$(awk '$1 == "toolchain" { sub(/^go/, "", $2); print $2; exit }' agent/go.mod)"
GO_IMAGE="${GO_IMAGE:-golang:$GO_VERSION-bookworm}"

# Версия проекта — версия manifest.json воркеров.
project_version() { node -p "require('./package.json').version"; }

# Версия agent-release — версия agent-sdk: из package.json (…/agent-sdk-<версия>.tgz) или
# node_modules/agent-sdk.
tool_version() {
  local v
  v="$(node -p "((require('./package.json').dependencies || {})['agent-sdk'] || '').match(/agent-sdk-([^/]+)\\.tgz$/)?.[1] || ''")"
  if [ -z "$v" ] && [ -f node_modules/agent-sdk/package.json ]; then
    v="$(node -p "require('./node_modules/agent-sdk/package.json').version")"
  fi
  [ -n "$v" ] || {
    echo "Версия agent-sdk не найдена (package.json, node_modules)" >&2
    exit 1
  }
  echo "$v"
}

worker_version() { tr -d '[:space:]' <"agent/workers/$1/VERSION"; }

# 1. Воркеры в каталог $1; печатает флаги --worker.
build_workers() {
  local dst="$1" name wv p file
  if [ -n "${WORKERS_PREBUILT:-}" ]; then
    echo "Воркеры — из $WORKERS_PREBUILT" >&2
    for name in $WORKERS; do
      wv="$(worker_version "$name")"
      for p in $PLATFORMS; do
        file="$WORKERS_PREBUILT/$name-$wv-$p"
        [ -f "$file" ] || {
          echo "Нет сборки $file" >&2
          exit 1
        }
        cp "$file" "$dst/"
      done
    done
  elif command -v go >/dev/null; then
    echo "Воркеры — сборка Go на машине: $PLATFORMS" >&2
    for name in $WORKERS; do
      wv="$(worker_version "$name")"
      for p in $PLATFORMS; do
        CGO_ENABLED=0 GOOS="${p%-*}" GOARCH="${p#*-}" go -C agent build -trimpath -buildvcs=false \
          -ldflags "-s -w -X main.version=$wv" -o "$dst/$name-$wv-$p" "./workers/$name"
      done
    done
  else
    echo "Воркеры — сборка в контейнере $GO_IMAGE: $PLATFORMS" >&2
    PLATFORMS="$PLATFORMS" GO_IMAGE="$GO_IMAGE" scripts/go-agent.sh build >&2
    for name in $WORKERS; do
      wv="$(worker_version "$name")"
      for p in $PLATFORMS; do cp "agent/dist/$name-$wv-$p" "$dst/"; done
    done
  fi
  chmod +x "$dst"/*-*-*-*
  for name in $WORKERS; do
    echo "Воркер $name $(worker_version "$name")" >&2
    echo "--worker=$name=$(worker_version "$name"),stopTimeout=$STOP_TIMEOUT"
  done
}

# 2. agent-release manifest над каталогом $1 (пишет $1/manifest.json).
write_manifest() {
  local dir="$1" v tool
  shift
  v="$(project_version)"
  if [ -n "${AGENT_RELEASE_TOOL:-}" ]; then
    "$AGENT_RELEASE_TOOL" manifest "$dir" "$v" "$@"
    return
  fi
  tool="$REPO/cmd/agent-release@v$(tool_version)"
  if command -v go >/dev/null; then
    (cd "$dir" && go run "$tool" manifest . "$v" "$@")
  elif command -v docker >/dev/null; then
    docker run --rm -v "$dir:/work" -w /tmp -v wg-agent-gomod:/go/pkg/mod \
      -e AGENT_SIGNING_KEY "$GO_IMAGE" go run "$tool" manifest /work "$v" "$@"
  else
    echo "Нужна утилита agent-release (AGENT_RELEASE_TOOL), Go или Docker" >&2
    return 1
  fi
}

# Проверка: сборок агента нет, каждая сборка воркера есть и её sha256 совпадает.
verify() {
  node - "$1" <<'JS'
const { createHash } = require("crypto");
const { readFileSync } = require("fs");
const { join } = require("path");
const dir = process.argv[2];
const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
let failed = m.artifacts.length > 0;
if (failed) console.error(`В manifest.json сборки агента: ${m.artifacts.length}`);
for (const a of m.workers || []) {
  const sum = createHash("sha256").update(readFileSync(join(dir, a.file))).digest("hex");
  if (sum !== a.sha256.toLowerCase()) {
    console.error(`${a.file}: sha256 ${sum}, в manifest.json ${a.sha256}`);
    failed = true;
  }
}
const unsigned = (m.workers || []).filter((w) => !w.signature).length;
console.error(`Воркеров: ${(m.workers || []).length}` + (unsigned ? ` (без подписи: ${unsigned})` : ""));
process.exit(failed ? 1 : 0);
JS
}

main() {
  local flags=() flag
  rm -rf "$OUT.new"
  mkdir -p "$OUT.new"
  while IFS= read -r flag; do flags+=("$flag"); done < <(build_workers "$OUT.new")
  write_manifest "$OUT.new" "${flags[@]}" >/dev/null
  verify "$OUT.new"
  rm -rf "$OUT"
  mv "$OUT.new" "$OUT"
  if [ -n "${AGENT_SIGNING_KEY:-}" ]; then
    echo "Воркеры подписаны ключом проекта: бэкенду нужен AGENT_UPDATE_PUBLIC_KEY этой пары" >&2
  else
    echo "Без AGENT_SIGNING_KEY воркеры wg и socks не подписаны" >&2
    echo "(установка сверит sha256; обновление воркеров с бэкенда агент не примет — UPDATE_NOT_VERIFIED)" >&2
  fi
  echo "Воркеры проекта $(project_version) — в $OUT (AGENT_RELEASES_DIR бэкенда)"
}

main "$@"
