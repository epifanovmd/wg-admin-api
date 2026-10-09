# syntax=docker/dockerfile:1.7
# Один образ на все роли процесса (APP_ROLE=api|worker|all) и миграции.
# Воркеры проекта для узлов (agent/release: wg, socks и их manifest.json)
# собираются здесь же — бэкенд раздаёт их (AGENT_RELEASES_DIR) вместе с
# агентом и netprobe, которые берёт из выпусков GitHub (AGENT_RELEASES_GITHUB).
# Стадии сборки идут на платформе сборщика (кросс-компиляция, без эмуляции);
# платформа образа влияет только на production-зависимости и runtime.
ARG NODE_VERSION=24-alpine
ARG GO_VERSION=1.26.9-bookworm

# ── Воркеры узла (linux и darwin × amd64 и arm64) и утилита выпуска ─────────
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS agent-workers
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY agent/internal ./internal
COPY agent/workers ./workers
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    for name in wg socks; do \
      version=$(tr -d '[:space:]' < workers/$name/VERSION); \
      for p in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64; do \
        CGO_ENABLED=0 GOOS=${p%-*} GOARCH=${p#*-} go build -trimpath -buildvcs=false \
          -ldflags "-s -w -X main.version=$version" -o /out/workers/$name-$version-$p ./workers/$name; \
      done; \
    done
# agent-release той же версии, что agent-sdk в package.json: manifest.json воркеров.
COPY package.json /tmp/package.json
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    version=$(sed -n 's|.*agent-sdk-\([^/"]*\)\.tgz".*|\1|p' /tmp/package.json) && \
    test -n "$version" && \
    CGO_ENABLED=0 GOBIN=/out/bin go install github.com/epifanovmd/agent/cmd/agent-release@v$version

# ── Воркеры проекта для узлов: сборки + manifest.json (без агента) ──────────
# Ключ подписи — необязательный секрет agent_signing_key (base64 из
# `agent-release keygen`): docker build --secret id=agent_signing_key,env=AGENT_SIGNING_KEY …
# С ним воркеры подписаны ключом проекта (бэкенду — AGENT_UPDATE_PUBLIC_KEY пары),
# без него не подписаны (agent/README.md, «Воркеры проекта»).
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS agent-release
RUN apk add --no-cache bash
WORKDIR /src
COPY package.json ./
COPY agent/go.mod agent/release.sh ./agent/
COPY agent/workers ./agent/workers
COPY --from=agent-workers /out/workers /workers
COPY --from=agent-workers /out/bin/agent-release /usr/local/bin/agent-release
RUN --mount=type=secret,id=agent_signing_key \
    if [ -s /run/secrets/agent_signing_key ]; then \
      AGENT_SIGNING_KEY="$(cat /run/secrets/agent_signing_key)"; export AGENT_SIGNING_KEY; \
    fi && \
    WORKERS_PREBUILT=/workers AGENT_RELEASE_TOOL=agent-release bash agent/release.sh

# ── Все зависимости для сборки ───────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000

# ── Генерация tsoa + tsc → build/ ────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json tsoa.json ./
COPY src ./src
RUN yarn build

# ── Только production-зависимости, без install-скриптов ──────────────────────
# На платформе образа: нативные модули (bcrypt) — под её архитектуру. Кэш
# yarn — в cache-mount BuildKit, в слой не попадает: чистить не нужно.
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production --ignore-scripts --network-timeout 600000

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS app
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

# tini — корректный PID 1: сигналы доходят до node, дочерние процессы убираются.
# Менеджеры пакетов в рантайме не нужны (старт и миграции — через node): меньше
# образ и CVE — зависимости встроенного npm сканер находит в образе.
RUN apk add --no-cache tini && \
    rm -rf /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
      /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/lib/node_modules/corepack /usr/local/bin/corepack && \
    chown -R node:node /app

COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/build ./build
# Ассеты рантайма (шаблоны писем) лежат вне build/ и читаются по пути от корня.
COPY --chown=node:node templates ./templates
# Воркеры проекта для узлов (AGENT_RELEASES_DIR=/app/agent/release).
COPY --from=agent-release --chown=node:node /src/agent/release ./agent/release

# Версия сборки (GET /api/v1/app/version) — последним слоем: меняется при
# каждой сборке и не сбрасывает кэш слоёв выше.
ARG APP_VERSION=dev
ARG APP_COMMIT=""
ARG APP_BUILT_AT=""
ENV APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_BUILT_AT=${APP_BUILT_AT}

USER node
EXPOSE 8181

# Liveness: процесс жив. Readiness (/ready) проверяет оркестратор.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||8181)+'/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "build/main.js"]
