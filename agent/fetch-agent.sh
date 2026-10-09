#!/usr/bin/env bash
# Сборки агента с GitHub (github.com/epifanovmd/agent) — для разработки и e2e:
#
#   agent/fetch-agent.sh [ВЕРСИЯ…]   → agent/dist/agent-<версия>/
#
# В каталоге — manifest.json, install.sh, программа агента agent-<os>-<arch> и netprobe под эту
# машину (все платформы — PLATFORMS="linux-amd64 linux-arm64 darwin-amd64 darwin-arm64").
# Версия по умолчанию — версия agent-sdk из package.json. Контрольные суммы сверяются с
# manifest.json. Скачанное не перезаписывается: каталог версии уже есть — пропуск.
#
# Программу агента отсюда берёт agent/dev.sh, а e2e раздаёт каталог бэкенду как источник сборок
# агента (AGENT_RELEASES_URL), не обращаясь к GitHub. Бэкенд в работе берёт агента сам — из
# релизов GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE="${AGENT_RELEASES_BASE:-https://github.com/epifanovmd/agent/releases/download}"

platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
  echo "$os-$arch"
}

sdk_version() {
  node -p "((require('./package.json').dependencies || {})['agent-sdk'] || '').match(/agent-sdk-([^/]+)\\.tgz$/)?.[1] || ''"
}

# Файлы сборок под платформы $2 из manifest.json $1 (агент и его воркеры).
files_for() {
  # shellcheck disable=SC2016 # шаблон JavaScript, не оболочки
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const want = new Set(process.argv[2].split(" "));
    for (const a of [...m.artifacts, ...(m.workers || [])])
      if (want.has(`${a.os}-${a.arch}`)) console.log(a.file);' "$1" "$2"
}

# sha256 файлов каталога $1 совпадают с manifest.json.
verify() {
  node - "$1" <<'JS'
const { createHash } = require("crypto");
const { existsSync, readFileSync } = require("fs");
const { join } = require("path");
const dir = process.argv[2];
const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
let failed = false;
for (const a of [...m.artifacts, ...(m.workers || [])]) {
  const file = join(dir, a.file);
  if (!existsSync(file)) continue;
  const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sum !== a.sha256.toLowerCase()) {
    console.error(`${a.file}: sha256 ${sum}, в manifest.json ${a.sha256}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
JS
}

fetch_version() {
  local v="$1" dir="agent/dist/agent-$1" tmp file
  if [ -f "$dir/manifest.json" ]; then
    echo "Агент $v — уже в $dir" >&2
    return
  fi
  tmp="$dir.new"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  echo "Агент $v — из $BASE/v$v" >&2
  curl -fsSL "$BASE/v$v/manifest.json" -o "$tmp/manifest.json"
  curl -fsSL "$BASE/v$v/install.sh" -o "$tmp/install.sh"
  for file in $(files_for "$tmp/manifest.json" "${PLATFORMS:-$(platform)}"); do
    curl -fsSL "$BASE/v$v/$file" -o "$tmp/$file"
  done
  verify "$tmp"
  chmod +x "$tmp"/*-*
  mv "$tmp" "$dir"
  echo "$dir"
}

main() {
  local v
  if [ $# -eq 0 ]; then
    v="$(sdk_version)"
    [ -n "$v" ] || {
      echo "Версия agent-sdk в package.json не найдена — укажите версию: $0 1.1.0" >&2
      exit 1
    }
    set -- "$v"
  fi
  for v in "$@"; do fetch_version "$v"; done
}

main "$@"
