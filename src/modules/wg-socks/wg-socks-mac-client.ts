import { isIP } from "node:net";

import { buildZip } from "./zip";

export interface IMacClientInput {
  serviceName: string;
  host: string;
  port: number;
  /** Имя для проверки серверного сертификата; null — без проверки имени. */
  checkHost: string | null;
  caCertPem: string;
  certPem: string;
  keyPem: string;
  username: string;
  password: string;
}

/** Строка в одинарных кавычках для sh. */
const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Имя каталога и метки launchd из названия прокси. */
export const macClientSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "proxy";

/** Проверка имени сервера в stunnel: для IP — `checkIP`. */
const stunnelNameCheck = (name: string): string =>
  `${isIP(name) ? "checkIP" : "checkHost"} = ${name}`;

/** Логин и пароль в query ссылки tg://socks. */
const tgCredentials = (input: IMacClientInput): string =>
  `&user=${encodeURIComponent(input.username)}` +
  `&pass=${encodeURIComponent(input.password)}`;

const installScript = (input: IMacClientInput, slug: string): string =>
  [
    "#!/bin/bash",
    "# Клиент SOCKS5-прокси через mTLS: stunnel + автозапуск launchd.",
    "# Локальный порт по умолчанию 1080: LOCAL_PORT=1081 bash install.sh",
    "set -euo pipefail",
    "",
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    `LABEL=${shq(`com.wg-admin.socks.${slug}`)}`,
    `APP="$HOME/.wg-admin-socks/${slug}"`,
    'PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"',
    'LOCAL_PORT="${LOCAL_PORT:-1080}"',
    `SOCKS_USER=${shq(input.username)}`,
    `SOCKS_PASS=${shq(input.password)}`,
    `TG_CREDS=${shq(tgCredentials(input))}`,
    "",
    'STUNNEL="$(command -v stunnel || true)"',
    'if [ -z "$STUNNEL" ]; then',
    "  if ! command -v brew >/dev/null 2>&1; then",
    '    echo "Нужен Homebrew (https://brew.sh) или установленный stunnel." >&2',
    "    exit 1",
    "  fi",
    '  echo "Устанавливаю stunnel через Homebrew…"',
    "  brew install stunnel",
    '  STUNNEL="$(command -v stunnel)"',
    "fi",
    "",
    'launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true',
    "sleep 1",
    'if lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then',
    '  echo "Порт $LOCAL_PORT уже занят (старый клиент?). Остановите его или: LOCAL_PORT=1081 bash install.sh" >&2',
    "  exit 1",
    "fi",
    "",
    'mkdir -p "$APP" "$HOME/Library/LaunchAgents"',
    'chmod 700 "$APP"',
    'cp "$DIR/ca.pem" "$DIR/client.pem" "$DIR/client-key.pem" "$APP/"',
    'chmod 600 "$APP/client-key.pem"',
    "",
    'cat > "$APP/stunnel.conf" <<EOF',
    "foreground = yes",
    "pid =",
    "",
    "[socks-tls]",
    "client = yes",
    "accept = 127.0.0.1:$LOCAL_PORT",
    `connect = ${input.host}:${input.port}`,
    "cert = $APP/client.pem",
    "key = $APP/client-key.pem",
    "CAfile = $APP/ca.pem",
    "verifyChain = yes",
    ...(input.checkHost ? [stunnelNameCheck(input.checkHost)] : []),
    "EOF",
    "",
    'cat > "$PLIST" <<EOF',
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key><string>$LABEL</string>",
    "  <key>ProgramArguments</key>",
    "  <array><string>$STUNNEL</string><string>$APP/stunnel.conf</string></array>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><true/>",
    "  <key>StandardOutPath</key><string>$APP/stunnel.log</string>",
    "  <key>StandardErrorPath</key><string>$APP/stunnel.log</string>",
    "</dict>",
    "</plist>",
    "EOF",
    "",
    'launchctl bootstrap "gui/$(id -u)" "$PLIST"',
    "",
    "for _ in 1 2 3 4 5 6 7 8 9 10; do",
    '  lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1 && break',
    "  sleep 0.5",
    "done",
    "",
    'echo "Проверка прокси…"',
    'if IP="$(curl -fsS --max-time 15 --socks5-hostname "127.0.0.1:$LOCAL_PORT" --proxy-user "$SOCKS_USER:$SOCKS_PASS" https://api.ipify.org)"; then',
    '  echo "Готово: прокси работает, внешний адрес $IP"',
    "else",
    '  echo "Прокси не ответил — смотрите журнал: $APP/stunnel.log" >&2',
    "fi",
    "",
    'echo ""',
    'echo "Telegram: SOCKS5 127.0.0.1:$LOCAL_PORT, логин $SOCKS_USER"',
    'echo "Ссылка для Telegram: tg://socks?server=127.0.0.1&port=$LOCAL_PORT$TG_CREDS"',
    "",
  ].join("\n");

const uninstallScript = (slug: string): string =>
  [
    "#!/bin/bash",
    "set -uo pipefail",
    "",
    `LABEL=${shq(`com.wg-admin.socks.${slug}`)}`,
    'launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true',
    'rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"',
    `rm -rf "$HOME/.wg-admin-socks/${slug}"`,
    'echo "Клиент прокси удалён (stunnel из Homebrew оставлен)."',
    "",
  ].join("\n");

const readme = (input: IMacClientInput, slug: string): string => {
  const link = `tg://socks?server=127.0.0.1&port=1080${tgCredentials(input)}`;

  return [
    `Клиент прокси «${input.serviceName}» для macOS`,
    "",
    "Установка (Терминал):",
    `  cd ~/Downloads/${slug}-mac`,
    "  bash install.sh",
    "",
    "Скрипт при необходимости ставит stunnel через Homebrew, кладёт",
    `сертификаты в ~/.wg-admin-socks/${slug} и включает автозапуск (launchd):`,
    "прокси работает после перезагрузки без действий с вашей стороны.",
    "Если порт 1080 занят (например, старым клиентом): LOCAL_PORT=1081 bash install.sh",
    "",
    "Telegram: Настройки → Данные и память → Прокси → Добавить прокси → SOCKS5",
    "  Сервер:  127.0.0.1",
    "  Порт:    1080",
    `  Логин:   ${input.username}`,
    `  Пароль:  ${input.password}`,
    "",
    "Или откройте ссылку:",
    `  ${link}`,
    "",
    "Проверка из Терминала:",
    `  curl --socks5-hostname 127.0.0.1:1080 --proxy-user '${input.username}:<пароль>' https://api.ipify.org`,
    "",
    `Сервер: ${input.host}:${input.port}`,
    `Журнал: ~/.wg-admin-socks/${slug}/stunnel.log`,
    "Удаление: bash uninstall.sh",
    "",
    "Архив содержит ключ клиента и пароль — не пересылайте его посторонним.",
    "",
  ].join("\n");
};

/** Готовый к запуску клиент для macOS: zip с install.sh, сертификатами и README. */
export const buildMacClient = (
  input: IMacClientInput,
): { fileName: string; content: Buffer } => {
  const slug = macClientSlug(input.serviceName);
  const dir = `${slug}-mac`;

  return {
    fileName: `${dir}.zip`,
    content: buildZip([
      {
        path: `${dir}/install.sh`,
        content: installScript(input, slug),
        mode: 0o755,
      },
      {
        path: `${dir}/uninstall.sh`,
        content: uninstallScript(slug),
        mode: 0o755,
      },
      { path: `${dir}/README.txt`, content: readme(input, slug) },
      { path: `${dir}/ca.pem`, content: input.caCertPem },
      { path: `${dir}/client.pem`, content: input.certPem },
      { path: `${dir}/client-key.pem`, content: input.keyPem, mode: 0o600 },
    ]),
  };
};
