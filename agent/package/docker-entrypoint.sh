#!/bin/sh
# Запуск агента в контейнере: пересылка пакетов на узле (туннели, пробросы, NAT) — то, что при
# установке службой задаёт install.sysctl агента, — затем сам агент.
set -eu
sysctl -qw net.ipv4.ip_forward=1 || echo "agent: net.ipv4.ip_forward не включён — нужен privileged (compose.yml)" >&2
sysctl -qw net.ipv6.conf.all.forwarding=1 2>/dev/null || true
exec ./agent "$@"
