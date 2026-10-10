#!/bin/sh
# Сборка воркера на Go (модуль agent/go.mod): Go на машине, иначе в контейнере golang
# (scripts/go-agent.sh). Его вызывают build и run в папке воркера:
#   go-worker.sh build ИМЯ   agent pack: программа под платформу GOOS/GOARCH → $OUT/run
#   go-worker.sh run ИМЯ     agent run на своей машине: собрать под эту машину и запустить
set -eu
AGENT="$(cd "$(dirname "$0")" && pwd)"
name="$2"
version="$(tr -d '[:space:]' <"$AGENT/workers/$name/VERSION")"

# gobuild OS ARCH ФАЙЛ — программа воркера под платформу.
gobuild() {
  if command -v go >/dev/null 2>&1; then
    (cd "$AGENT" && CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -trimpath -buildvcs=false \
      -ldflags "-s -w -X main.version=$version" -o "$3" "./workers/$name")
  else
    "$AGENT/../scripts/go-agent.sh" build "$1" "$2" >/dev/null
    cp "$AGENT/dist/$name-$version-$1-$2" "$3"
  fi
}

case "$1" in
  build) gobuild "$GOOS" "$GOARCH" "$OUT/run" ;;
  run)
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
    mkdir -p "$AGENT/workers/$name/.bin"
    gobuild "$os" "$arch" "$AGENT/workers/$name/.bin/$name"
    exec "$AGENT/workers/$name/.bin/$name"
    ;;
  *)
    echo "использование: $0 build|run ИМЯ" >&2
    exit 2
    ;;
esac
