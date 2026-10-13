# syntax=docker/dockerfile:1.7
# Один образ на все роли процесса (APP_ROLE=api|worker|all) и миграции.
# Архивы папки агента для нод (agent pack: агент, настройки, воркеры wg и socks)
# собираются здесь же — бэкенд раздаёт их (AGENT_BUNDLE_DIR); новые версии агента
# узлы берут из своего каталога сборок (релизы GitHub агента).
# Стадии сборки идут на платформе сборщика (кросс-компиляция, без эмуляции);
# платформа образа влияет только на production-зависимости и runtime.
ARG NODE_VERSION=24-alpine
ARG GO_VERSION=1.26.9-bookworm

# ── Архивы папки агента для нод (agent pack) ─────────────────────────────────
# agent pack --env prod: по архиву на linux/amd64 и linux/arm64 — программа агента,
# agent.yaml + agent.prod.yaml, воркеры wg и socks, собранные под платформу (их build —
# go build здесь же), release/ — сборки воркеров для обновления нод и install.sh —
# установщик агента (API раздаёт его вместе с архивами). Программа агента и install.sh —
# с GitHub Release версии AGENT_VERSION (build-arg, по умолчанию — из .env.example);
# агента под другие платформы pack берёт оттуда же.
# Ключ подписи воркеров — необязательный секрет agent_signing_key (openssl, agent/README.md):
# docker build --secret id=agent_signing_key,env=AGENT_SIGNING_KEY …; без него воркеры
# ставятся, но с API не обновляются. Открытый ключ pack кладёт в архив сам.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS agent-bundle
WORKDIR /src
ARG AGENT_VERSION
COPY .env.example ./
RUN version=${AGENT_VERSION:-$(sed -n 's/^AGENT_VERSION=\([^[:space:]]*\).*/\1/p' .env.example)} && test -n "$version" && \
    arch=$(dpkg --print-architecture) && \
    base="https://github.com/epifanovmd/agent/releases/download/v$version" && \
    curl -fsSL "$base/manifest.json" -o /tmp/manifest.json && \
    sha=$(awk -v f="\"agent-linux-$arch\"" '$0 ~ "\"file\": " f { getline; gsub(/[",]/, "", $2); print $2; exit }' /tmp/manifest.json) && \
    test -n "$sha" && curl -fsSL "$base/agent-linux-$arch" -o /usr/local/bin/agent && \
    echo "$sha  /usr/local/bin/agent" | sha256sum -c - && chmod +x /usr/local/bin/agent && \
    curl -fsSL "$base/install.sh" -o /usr/local/share/agent-install.sh
COPY agent/go.mod agent/go.sum ./agent/
# Модуль агента — прямо с GitHub, мимо прокси и базы сумм Go (сумма — в go.sum).
ENV GOPRIVATE=github.com/epifanovmd/*
RUN --mount=type=cache,target=/go/pkg/mod cd agent && go mod download
COPY agent/agent.yaml agent/agent.prod.yaml agent/go-worker.sh ./agent/
COPY agent/internal ./agent/internal
COPY agent/workers ./agent/workers
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=secret,id=agent_signing_key \
    if [ -s /run/secrets/agent_signing_key ]; then \
      AGENT_SIGNING_KEY="$(cat /run/secrets/agent_signing_key)"; export AGENT_SIGNING_KEY; \
    fi && \
    cd agent && AGENT_NO_UPDATE_CHECK=1 agent pack --env prod --platform linux/amd64,linux/arm64 \
      --out /agent-bundle --release-out /agent-bundle/release && \
    cp /usr/local/share/agent-install.sh /agent-bundle/install.sh

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
    NODE_OPTIONS=--enable-source-maps \
    AGENT_BUNDLE_DIR=agent/bundle

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
# Архивы папки агента для нод (AGENT_BUNDLE_DIR выше): их раздаёт API.
COPY --from=agent-bundle --chown=node:node /agent-bundle ./agent/bundle

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
