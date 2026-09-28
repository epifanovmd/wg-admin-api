#!/bin/sh
# Установщик агента wg-admin — один для ручной установки и для установки по
# SSH из админки. Ставит зависимости, скачивает бинарь своей архитектуры с
# бэкенда по ключу агента, сверяет sha256, пишет env и unit systemd, запускает.
# Изменения хоста (пакеты, forwarding, модули) пишутся в журнал установки;
# --uninstall — остановка с откатом созданного агентом, откат по журналу и
# удаление всего агента.
#   curl -fsSL <бэкенд>/api/v1/wg-agent/install.sh | sudo sh -s -- --key <ключ агента>
#   … | sudo sh -s -- --key-file <файл с ключом>
#   … | sudo sh -s -- --uninstall
#
# BACKEND_URL бэкенд подставляет при выдаче файла.
# WG_ADMIN_INSTALL_LIB=1 — только объявить функции (тесты подключают файл
# через `.`).
set -eu

BACKEND_URL=__BACKEND_URL__
KEY=""
ACTION=install
BIN=/usr/local/bin/wg-admin-agent
ETC=/etc/wg-admin
UNIT=/etc/systemd/system/wg-admin-agent.service
START=0

log() { printf '▶ [%ss] %s\n' "$(($(date +%s) - START))" "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }


APPARMOR_DIR=/etc/apparmor.d
# Профили AppArmor wg и wg-quick (Ubuntu 24.10+) читают конфиги только из
# /etc/wireguard: каталог агента добавляется в их локальные дополнения.
allow_apparmor() {
  command -v apparmor_parser >/dev/null 2>&1 || return 0
  for profile in wg wg-quick; do
    [ -f "$APPARMOR_DIR/$profile" ] || continue
    grep -q "local/$profile" "$APPARMOR_DIR/$profile" || continue
    mkdir -p "$APPARMOR_DIR/local"
    if ! grep -q "wg-admin begin" "$APPARMOR_DIR/local/$profile" 2>/dev/null; then
      printf '%s\n' '# wg-admin begin' '/etc/wg-admin/wireguard/ r,' \
        '/etc/wg-admin/wireguard/** r,' '# wg-admin end' >> "$APPARMOR_DIR/local/$profile"
    fi
    apparmor_parser -r "$APPARMOR_DIR/$profile" >/dev/null 2>&1 || true
  done
}
revoke_apparmor() {
  for profile in wg wg-quick; do
    local_file="$APPARMOR_DIR/local/$profile"
    if [ ! -f "$local_file" ] || ! grep -q "wg-admin begin" "$local_file"; then continue; fi
    sed -i.bak '/# wg-admin begin/,/# wg-admin end/d' "$local_file" && rm -f "$local_file.bak"
    if command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser -r "$APPARMOR_DIR/$profile" >/dev/null 2>&1 || true
    fi
  done
}

INSTALL_STATE=/etc/wg-admin/install-state
SYSCTL_CONF=/etc/sysctl.d/99-wg-admin.conf
MODULES_DIR=/sys/module
PM=none

# Журнал установки: что было на хосте до неё. Значение пишется один раз —
# повторная установка не перезаписывает исходное состояние.
state_get() {
  [ -f "$INSTALL_STATE" ] || return 0
  sed -n "s/^$1=//p" "$INSTALL_STATE" | tail -1
}
state_once() {
  if [ -f "$INSTALL_STATE" ] && grep -q "^$1=" "$INSTALL_STATE"; then return 0; fi
  mkdir -p "$(dirname "$INSTALL_STATE")"
  printf '%s=%s\n' "$1" "$2" >> "$INSTALL_STATE"
}
state_add() {
  current=$(state_get "$1")
  case " $current " in *" $2 "*) return 0 ;; esac
  mkdir -p "$(dirname "$INSTALL_STATE")"
  touch "$INSTALL_STATE"
  grep -v "^$1=" "$INSTALL_STATE" > "$INSTALL_STATE.new" || true
  printf '%s=%s\n' "$1" "$(echo "$current $2" | sed 's/^ *//')" >> "$INSTALL_STATE.new"
  mv -f "$INSTALL_STATE.new" "$INSTALL_STATE"
}

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then PM=apt
  elif command -v dnf >/dev/null 2>&1; then PM=dnf
  elif command -v yum >/dev/null 2>&1; then PM=yum
  elif command -v apk >/dev/null 2>&1; then PM=apk
  else PM=none; fi
}
agent_packages() {
  case "$PM" in
    apt) echo "wireguard-tools iproute2 iptables conntrack iputils-ping ca-certificates curl" ;;
    dnf|yum) echo "wireguard-tools iproute iptables conntrack-tools iputils curl" ;;
    apk) echo "wireguard-tools iproute2 iptables conntrack-tools iputils curl" ;;
  esac
}
pkg_installed() {
  case "$PM" in
    apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
    dnf|yum) rpm -q "$1" >/dev/null 2>&1 ;;
    apk) apk info -e "$1" >/dev/null 2>&1 ;;
    *) return 0 ;;
  esac
}
# Все установленные пакеты: разница до и после — вместе с зависимостями.
pkg_all() {
  case "$PM" in
    apt) dpkg-query -W -f='${Package}\n' 2>/dev/null ;;
    dnf|yum) rpm -qa --qf '%{NAME}\n' 2>/dev/null ;;
  esac
}

# Недостающие пакеты; без нехватки — ни apt-get update, ни установки.
ensure_packages() {
  missing=""
  for pkg in "$@"; do pkg_installed "$pkg" || missing="$missing $pkg"; done
  if [ -z "$missing" ]; then
    log "Зависимости уже установлены"
    return 0
  fi
  log "Установка пакетов:$missing"
  snapshot=$(mktemp)
  pkg_all | sort > "$snapshot"
  # shellcheck disable=SC2086 # $missing — список пакетов, намеренно по словам
  case "$PM" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $missing >/dev/null ;;
    dnf) dnf install -y -q $missing >/dev/null ;;
    yum) yum install -y -q $missing >/dev/null ;;
    apk) apk add --no-cache -q $missing >/dev/null ;;
  esac
  if [ "$PM" = apk ]; then
    added=$missing
  else
    added=$(pkg_all | sort | comm -13 "$snapshot" -)
  fi
  rm -f "$snapshot"
  for pkg in $added; do state_add PACKAGES "$pkg"; done
}

ensure_modules() {
  for module in wireguard ipip; do
    [ -d "$MODULES_DIR/$module" ] && continue
    if modprobe "$module" 2>/dev/null; then state_add MODULES "$module"; fi
  done
}

enable_forwarding() {
  state_once IPV4_FORWARD "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)"
  state_once IPV6_FORWARD "$(sysctl -n net.ipv6.conf.all.forwarding 2>/dev/null || echo 0)"
  printf 'net.ipv4.ip_forward=1\nnet.ipv6.conf.all.forwarding=1\n' > "$SYSCTL_CONF"
  sysctl -q -p "$SYSCTL_CONF" >/dev/null 2>&1 || true
}

restore_sysctl() {
  [ -n "$2" ] || return 0
  [ "$(sysctl -n "$1" 2>/dev/null)" = "$2" ] && return 0
  if [ "$2" = 0 ] && [ "$DOCKER_ACTIVE" = yes ]; then
    log "$1 оставлен включённым: Docker без него теряет сеть"
    return 0
  fi
  sysctl -qw "$1=$2" >/dev/null 2>&1 || true
  log "$1 возвращён в $2"
}
remove_package() {
  case "$PM" in
    apt) dpkg -r "$1" >/dev/null 2>&1 ;;
    dnf|yum) rpm -e "$1" >/dev/null 2>&1 ;;
    apk) apk del -q "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# Откат по журналу: только то, что изменила установка.
revert_install() {
  rm -f "$SYSCTL_CONF"
  if [ ! -f "$INSTALL_STATE" ]; then
    log "Журнала установки нет — пакеты и настройки хоста оставлены как есть"
    return 0
  fi
  DOCKER_ACTIVE=no
  if systemctl is-active --quiet docker 2>/dev/null; then DOCKER_ACTIVE=yes; fi
  restore_sysctl net.ipv4.ip_forward "$(state_get IPV4_FORWARD)"
  restore_sysctl net.ipv6.conf.all.forwarding "$(state_get IPV6_FORWARD)"
  for module in $(state_get MODULES); do
    if modprobe -r "$module" 2>/dev/null; then log "Модуль $module выгружен"
    else log "Модуль $module занят — оставлен"; fi
  done
  # Несколько проходов: зависимость удаляется после зависящего от неё пакета.
  left=""
  for pkg in $(state_get PACKAGES); do
    case "$pkg" in
      iptables|conntrack|conntrack-tools)
        if command -v docker >/dev/null 2>&1; then
          log "Пакет $pkg оставлен: нужен Docker"
          continue
        fi ;;
    esac
    left="$left $pkg"
  done
  for _pass in 1 2 3; do
    next=""
    for pkg in $left; do
      pkg_installed "$pkg" || continue
      remove_package "$pkg" || next="$next $pkg"
    done
    left=$next
  done
  for pkg in $left; do
    pkg_installed "$pkg" && log "Пакет $pkg оставлен: нужен другим пакетам"
  done
  return 0
}

main_pid() { systemctl show -p MainPID --value wg-admin-agent 2>/dev/null || echo 0; }

# Страховка самообновления (ExecStartPre): откат агента проверяет сам новый
# бинарь, и версия, падающая раньше этой проверки, не откатилась бы никогда.
# Пока лежит маркер обновления, считаются запуски; после GUARD_STARTS прежний
# бинарь возвращается на место. Агент откатывает раньше — на 4-м запуске.
write_boot_guard() {
  cat > "$1" <<'GUARD'
#!/bin/sh
GUARD_STARTS=5
dir=${WG_AGENT_CONFIG_DIR:-/etc/wg-admin/wireguard}
bin=${WG_AGENT_BIN:-/usr/local/bin/wg-admin-agent}
marker="$dir/.agent-update"
starts="$dir/.agent-update.starts"
if [ ! -f "$marker" ]; then
  rm -f "$starts"
  exit 0
fi
count=$(cat "$starts" 2>/dev/null || true)
case "$count" in ''|*[!0-9]*) count=0 ;; esac
count=$((count + 1))
if [ "$count" -ge "$GUARD_STARTS" ] && [ -f "$bin.prev" ]; then
  mv -f "$bin.prev" "$bin"
  rm -f "$marker" "$starts"
  echo "Новая версия агента не запускается — возвращена прежняя"
  exit 0
fi
echo "$count" > "$starts"
GUARD
  chmod 700 "$1"
}

uninstall_agent() {
  log "Остановка агента (откат созданного им)"
  systemctl disable --now wg-admin-agent >/dev/null 2>&1 || true
  if [ -x "$BIN" ]; then "$BIN" cleanup || true; fi
  revoke_apparmor
  log "Возврат хоста к состоянию до установки"
  revert_install
  rm -f "$UNIT" "$BIN" "$BIN.prev" "$BIN.new"
  systemctl daemon-reload
  rm -rf "$ETC"
  log "Агент удалён"
}

install_agent() {
  [ -n "$KEY" ] || die "Не передан ключ агента: --key <ключ> или --key-file <файл>"
  [ -n "$BACKEND_URL" ] || die "Не задан адрес бэкенда: --backend <URL>"

  case "$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "Архитектура $(uname -m) не поддерживается" ;;
  esac

  log "Зависимости"
  if [ "$PM" = none ]; then
    log "Пакетный менеджер не найден — wireguard-tools, iproute2, iptables, conntrack, ping, curl нужны заранее"
  else
    # shellcheck disable=SC2046 # список пакетов — намеренно по словам
    ensure_packages $(agent_packages)
  fi
  ensure_modules
  if [ ! -d "$MODULES_DIR/wireguard" ] && ! command -v wireguard-go >/dev/null 2>&1; then
    log "Модуля ядра WireGuard нет — ставлю wireguard-go"
    ensure_packages wireguard-go || log "wireguard-go не установлен: интерфейсы не поднимутся без модуля ядра"
  fi

  log "IP forwarding"
  enable_forwarding

  log "Загрузка агента ($ARCH)"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 3 -H "X-Api-Key: $KEY" -D "$TMP/headers" -o "$TMP/agent" "$BACKEND_URL/api/v1/wg-agent/binary/$ARCH" \
    || die "Не удалось скачать агента с $BACKEND_URL (ключ верный? бэкенд доступен?)"
  EXPECTED=$(tr -d '\r' < "$TMP/headers" | awk 'tolower($1) == "x-agent-sha256:" { print $2 }' | tail -1)
  ACTUAL=$(sha256sum "$TMP/agent" | awk '{ print $1 }')
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || die "sha256 бинаря не совпадает с заявленным бэкендом"
  install -m 0755 "$TMP/agent" "$BIN.new"
  mv -f "$BIN.new" "$BIN"

  log "Конфигурация"
  mkdir -p "$ETC/wireguard"
  allow_apparmor
  chmod 700 "$ETC" "$ETC/wireguard"
  umask 077
  printf 'WG_AGENT_BACKEND_URL=%s\nWG_AGENT_KEY=%s\n' "$BACKEND_URL" "$KEY" > "$ETC/agent.env"
  chmod 600 "$ETC/agent.env"

  log "Служба systemd"
  write_boot_guard "$ETC/boot-guard.sh"
  # KillMode=process: при перезапуске (обновление, HUP) systemd не добивает
  # wireguard-go из cgroup службы — userspace-интерфейсы остаются. При
  # остановке их снимает сам агент (откат). StartLimitIntervalSec=0 — без
  # лимита запусков: systemd не бросает агента после серии падений; пауза
  # растёт от 1 до 30 с (RestartSteps, systemd 254+; старый — игнорирует).
  # TimeoutStopSec — запас на откат после текущего применения конфигурации.
  cat > "$UNIT" <<'UNIT'
[Unit]
Description=wg-admin agent (WireGuard node)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
EnvironmentFile=/etc/wg-admin/agent.env
Environment=WG_AGENT_CONFIG_DIR=/etc/wg-admin/wireguard
ExecStartPre=-/etc/wg-admin/boot-guard.sh
ExecStart=/usr/local/bin/wg-admin-agent
Restart=always
RestartSec=1
RestartSteps=5
RestartMaxDelaySec=30
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable wg-admin-agent >/dev/null 2>&1

  # Работающий агент перезапускается сигналом HUP — без отката: интерфейсы,
  # туннели и правила остаются, клиенты не теряют связь; systemd поднимает
  # новый бинарь с новым ключом.
  OLD_PID=0
  if systemctl is-active --quiet wg-admin-agent; then
    OLD_PID=$(main_pid)
    log "Перезапуск агента без отката"
    systemctl kill -s HUP --kill-who=main wg-admin-agent
  else
    systemctl restart wg-admin-agent
  fi

  started=no
  for _ in $(seq 1 40); do
    PID=$(main_pid)
    if systemctl is-active --quiet wg-admin-agent && [ "$PID" != 0 ] && [ "$PID" != "$OLD_PID" ]; then
      started=yes
      break
    fi
    sleep 0.25
  done
  if [ "$started" != yes ]; then
    journalctl -u wg-admin-agent -n 30 --no-pager || true
    die "Агент не запустился"
  fi
  log "Агент запущен: $("$BIN" version)"
}

# --key-file — ключ из файла: в отличие от --key, не виден в списке процессов
# (ps, /proc/*/cmdline) всё время установки.
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --key) KEY="${2:-}"; shift 2 ;;
      --key-file)
        [ -r "${2:-}" ] || die "Файл ключа не читается: ${2:-}"
        KEY=$(tr -d ' \t\r\n' < "$2"); shift 2 ;;
      --backend) BACKEND_URL="${2:-}"; shift 2 ;;
      --uninstall) ACTION=uninstall; shift ;;
      *) die "Неизвестный параметр: $1" ;;
    esac
  done
}

main() {
  START=$(date +%s)
  parse_args "$@"

  [ "$(id -u)" = 0 ] || die "Нужны права root (sudo)"
  command -v systemctl >/dev/null 2>&1 || die "Нужен systemd"

  detect_pm

  if [ "$ACTION" = uninstall ]; then
    uninstall_agent
  else
    install_agent
  fi
}

[ "${WG_ADMIN_INSTALL_LIB:-}" = 1 ] || main "$@"
