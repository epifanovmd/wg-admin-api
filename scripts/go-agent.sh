#!/usr/bin/env bash
# Go воркеров узла (agent/) в контейнере golang — без установки Go на машину.
# Версия Go — toolchain из agent/go.mod (go1.26.9 → образ golang:1.26.9-bookworm) или GO_IMAGE.
#   scripts/go-agent.sh test | vet | tidy | fmt
#   scripts/go-agent.sh build [os [arch]]   воркеры wg и socks → agent/dist/<имя>-<версия>-<os>-<arch>
#                                           (без аргументов — PLATFORMS или linux и darwin × amd64 и arm64)
#   scripts/go-agent.sh <любая команда>     например: go test -run TestHealth ./workers/wg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_VERSION=$(awk '$1 == "toolchain" { sub(/^go/, "", $2); print $2; exit }' "$ROOT/agent/go.mod")
IMAGE=${GO_IMAGE:-golang:$GO_VERSION-bookworm}
WORKERS="wg socks"
run() {
  docker run --rm -v "$ROOT/agent:/src" -w /src \
    -v wg-agent-gomod:/go/pkg/mod -v wg-agent-gocache:/root/.cache/go-build \
    -e CGO_ENABLED=0 "$@"
}
case "${1:-test}" in
  test) run "$IMAGE" go test ./... ;;
  vet) run "$IMAGE" go vet ./... ;;
  tidy) run "$IMAGE" go mod tidy ;;
  fmt) run "$IMAGE" gofmt -l -w . ;;
  build)
    if [ $# -ge 2 ]; then platforms="$2-${3:-amd64}"; else platforms=${PLATFORMS:-linux-amd64 linux-arm64 darwin-amd64 darwin-arm64}; fi
    # shellcheck disable=SC2016 # переменные раскрывает sh в контейнере
    script='set -e
      for name in $WORKERS; do
        version=$(tr -d "[:space:]" < workers/$name/VERSION)
        for p in $PLATFORMS; do
          GOOS=${p%-*} GOARCH=${p#*-} go build -trimpath -buildvcs=false \
            -ldflags "-s -w -X main.version=$version" -o "dist/$name-$version-$p" ./workers/$name
          echo "dist/$name-$version-$p"
        done
      done'
    run -e WORKERS="$WORKERS" -e PLATFORMS="$platforms" "$IMAGE" sh -c "$script" ;;
  *) run "$IMAGE" "$@" ;;
esac
