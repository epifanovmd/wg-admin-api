# syntax=docker/dockerfile:1.7
# Один образ на все роли процесса (APP_ROLE=api|worker|all) и миграции.
# Бинари агента нод (Go, linux/amd64 и arm64) собираются здесь же — бэкенд
# раздаёт их при установке и обновлении агентов. Стадии сборки идут на
# платформе сборщика (кросс-компиляция, без эмуляции); платформа образа
# влияет только на production-зависимости и runtime.
ARG NODE_VERSION=24-alpine
ARG GO_VERSION=1.26-bookworm

# ── Агент нод: статические бинари под обе архитектуры ───────────────────────
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS agent
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY agent/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    version=$(cat VERSION) && \
    for arch in amd64 arm64; do \
      CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath \
        -ldflags "-s -w -X main.version=$version" \
        -o dist/wg-admin-agent-linux-$arch ./cmd/wg-admin-agent; \
    done && cp VERSION dist/VERSION

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
# Бинари агента: раздаются по ключу агента (установка и обновление).
COPY --from=agent --chown=node:node /agent/dist ./agent/dist

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
