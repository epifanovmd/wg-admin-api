#!/usr/bin/env bash
# Проверки версии агента для CI:
#   1. Код агента изменился с последнего релизного тега — agent/VERSION поднята:
#      иначе разные бинари уходят на ноды под одной версией. Тесты и README
#      не в счёт.
#   2. Ветка Go в Dockerfile-ах (GO_VERSION) совпадает с agent/go.mod: CI и
#      scripts/go-agent.sh берут её из go.mod, образы — из ARG.
# Нужна история с тегами (actions/checkout: fetch-depth: 0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0

go_branch=$(awk '$1 == "go" { split($2, v, "."); print v[1] "." v[2]; exit }' agent/go.mod)
for file in Dockerfile test/smoke/Dockerfile.agent; do
  declared=$(sed -n 's/^ARG GO_VERSION=\([0-9][0-9.]*\).*/\1/p' "$file")
  if [ "$declared" != "$go_branch" ]; then
    echo "::error file=$file::GO_VERSION=$declared, а в agent/go.mod — go $go_branch"
    fail=1
  fi
done

last_tag=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
if [ -z "$last_tag" ]; then
  echo "Релизных тегов нет — проверка agent/VERSION пропущена"
else
  changed=$(git diff --name-only "$last_tag" HEAD -- agent \
    ':(exclude,glob)agent/**/*_test.go' ':(exclude,glob)agent/**/*.md' ':(exclude)agent/VERSION')
  if [ -n "$changed" ] && git diff --quiet "$last_tag" HEAD -- agent/VERSION; then
    echo "::error file=agent/VERSION::Код агента изменён с $last_tag, а agent/VERSION ($(cat agent/VERSION)) — нет:"
    echo "$changed"
    fail=1
  fi
fi

exit "$fail"
