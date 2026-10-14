# syntax=docker/dockerfile:1.7
# Агент из этого архива в контейнере: программа агента, настройки и воркеры wg и socks — отсюда же
# (программу под платформу образа выбирает скрипт agent, воркеры собраны под amd64 и arm64).
# Воркер wg настраивает сам узел — контейнер работает в сети узла с правами на неё (compose.yml).
# Обычно — через compose.yml:
#
#   cp .env.example .env    # адрес, токен, имя
#   docker compose up -d --build
#
# Обновление — новым архивом и пересборкой (update.mode: external); ключ агента — в томе.
FROM debian:12-slim

# upgrade — исправления безопасности базового образа (он отстаёт от репозитория Debian).
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
      wireguard-tools iproute2 iptables conntrack iputils-ping procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/agent
COPY . .
VOLUME ["/var/lib/agent", "/etc/wireguard"]

# Жив ли агент с этим dataDir.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["./agent", "status", "--env", "docker"]

# SIGTERM: агент останавливает воркеры (в контейнере — всегда вместе с собой).
STOPSIGNAL SIGTERM
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["run", "--env", "docker"]
