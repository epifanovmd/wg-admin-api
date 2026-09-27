#!/usr/bin/env bash
# Команды Go для агента в контейнере golang — без установки Go на машину.
# Ветка Go — из agent/go.mod (1.26.0 → образ 1.26 с последним патчем) или GO_IMAGE.
#   scripts/go-agent.sh test | vet | build [amd64|arm64] | tidy | <любая команда>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_VERSION=$(awk '$1 == "go" { split($2, v, "."); print v[1] "." v[2]; exit }' "$ROOT/agent/go.mod")
IMAGE=${GO_IMAGE:-golang:$GO_VERSION-bookworm}
run() {
  docker run --rm -v "$ROOT/agent:/src" -w /src \
    -v wg-agent-gomod:/go/pkg/mod -v wg-agent-gocache:/root/.cache/go-build \
    -e CGO_ENABLED=0 "$@"
}
case "${1:-test}" in
  test) run "$IMAGE" go test ./... ;;
  vet) run "$IMAGE" go vet ./... ;;
  tidy) run "$IMAGE" go mod tidy ;;
  build)
    arch=${2:-amd64}
    version=${AGENT_VERSION:-$(cat "$ROOT/agent/VERSION")}
    run -e GOOS=linux -e GOARCH="$arch" "$IMAGE" \
      go build -trimpath -ldflags "-s -w -X main.version=$version" \
      -o "dist/wg-admin-agent-linux-$arch" ./cmd/wg-admin-agent ;;
  *) run "$IMAGE" "$@" ;;
esac
