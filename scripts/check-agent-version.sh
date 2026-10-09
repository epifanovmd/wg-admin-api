#!/usr/bin/env bash
# Проверки версий воркеров узла для CI:
#   1. Код воркера изменился с последнего релизного тега — его VERSION
#      (agent/workers/<имя>/VERSION) поднята: иначе разные сборки уходят на узлы
#      под одной версией и агент не заменит воркер. Код воркера — его каталог,
#      общий код (agent/internal, go.mod, go.sum) — код всех воркеров. Тесты и
#      *.md не в счёт.
#   2. Версия Go в Dockerfile-ах (GO_VERSION) совпадает с toolchain в
#      agent/go.mod: CI и scripts/go-agent.sh берут её из go.mod, образы — из ARG.
# Нужна история с тегами (actions/checkout: fetch-depth: 0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0

go_version=$(awk '$1 == "toolchain" { sub(/^go/, "", $2); print $2; exit }' agent/go.mod)
for file in Dockerfile test/smoke/Dockerfile.agent; do
  declared=$(sed -n 's/^ARG GO_VERSION=\([0-9][0-9.]*\).*/\1/p' "$file")
  if [ "$declared" != "$go_version" ]; then
    echo "::error file=$file::GO_VERSION=$declared, а в agent/go.mod — toolchain go$go_version"
    fail=1
  fi
done

last_tag=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
if [ -z "$last_tag" ]; then
  echo "Релизных тегов нет — проверка версий воркеров пропущена"
  exit "$fail"
fi

code_changes() { # code_changes PATH... — изменённый код с последнего тега
  git diff --name-only "$last_tag" HEAD -- "$@" \
    ':(exclude,glob)agent/**/*_test.go' ':(exclude,glob)agent/**/*.md' ':(exclude,glob)agent/workers/*/VERSION'
}

shared=$(code_changes agent/internal agent/go.mod agent/go.sum)
for dir in agent/workers/*/; do
  dir=${dir%/}
  [ -f "$dir/VERSION" ] || continue
  changed=$(printf '%s\n%s\n' "$shared" "$(code_changes "$dir")" | sed '/^$/d')
  if [ -n "$changed" ] && git diff --quiet "$last_tag" HEAD -- "$dir/VERSION"; then
    echo "::error file=$dir/VERSION::Код воркера $(basename "$dir") изменён с $last_tag, а $dir/VERSION ($(tr -d '[:space:]' <"$dir/VERSION")) — нет:"
    echo "$changed"
    fail=1
  fi
done

exit "$fail"
