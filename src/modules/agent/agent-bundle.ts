import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";

import { agentConfig } from "./agent.config";

/** Архивы папки агента для узлов и скрипт установки из них. */
export const BUNDLE_PATH = "/api/v1/agent-bundle";

/** Скрипт установки агента проекта с этого сервера. */
export const bundleInstallUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${BUNDLE_PATH}/install.sh`;

/** Значение в одинарных кавычках POSIX sh. */
const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Скрипт установки: архив папки агента под эту машину (`agent pack`) с этого
 * сервера → `agent install --server <сервер>` с аргументами скрипта
 * (`--token`, `--token-file` и другие флаги `agent install`); `--uninstall
 * [--purge]` — удалить агента тем же архивом (экземпляр — из его настроек).
 */
export const installScript = (baseUrl: string): string => {
  const base = baseUrl.replace(/\/+$/, "");

  return `#!/bin/sh
# Агент проекта с ${base}: архив папки агента (agent pack) под эту машину и agent install.
#   curl -fsSL ${bundleInstallUrl(base)} | sudo sh -s -- --token <токен>
#   … | sudo sh -s -- --uninstall [--purge]
set -eu
SERVER=${shQuote(base)}
[ "$(uname -s)" = Linux ] || { echo "agent: установка службой — только Linux с systemd" >&2; exit 1; }
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "agent: процессор $(uname -m) не поддерживается" >&2; exit 1 ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="$SERVER${BUNDLE_PATH}/linux-$ARCH.tar.gz"
if command -v curl >/dev/null 2>&1; then curl -fsSL "$URL" -o "$TMP/agent.tar.gz"; else wget -qO "$TMP/agent.tar.gz" "$URL"; fi
tar xzf "$TMP/agent.tar.gz" -C "$TMP"
if [ "\${1:-}" = "--uninstall" ]; then
  shift
  "$TMP/agent/agent" uninstall "$@"
else
  "$TMP/agent/agent" install --server "$SERVER" "$@"
fi
`;
};

/** Команда установки одной строкой: токен — значением или файлом на узле, имя агента. */
export const installCommand = (
  baseUrl: string,
  opts: { token?: string; tokenFile?: string; name?: string },
): string => {
  const flag = opts.tokenFile
    ? `--token-file ${shQuote(opts.tokenFile)}`
    : `--token ${shQuote(opts.token ?? "")}`;
  const name = opts.name ? ` --name ${shQuote(opts.name)}` : "";

  return `curl -fsSL ${shQuote(bundleInstallUrl(baseUrl))} | sudo sh -s -- ${flag}${name}`;
};

const RE_PLATFORM = /^(linux|darwin)-(amd64|arm64)\.tar\.gz$/;
const RE_ARCHIVE =
  /^agent-[a-z0-9-]+-[0-9][^/]*-(linux|darwin)-(amd64|arm64)\.tar\.gz$/;

/** Архив под платформу в каталоге архивов (новейший по времени, если их несколько). */
export const bundleFile = (
  dir: string,
  os: string,
  arch: string,
): string | undefined => {
  if (!existsSync(dir)) return undefined;
  const found = readdirSync(dir)
    .filter(name => {
      const m = RE_ARCHIVE.exec(name);

      return m?.[1] === os && m[2] === arch;
    })
    .map(name => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  return found[0];
};

const send = (res: ServerResponse, status: number, message: string) =>
  res
    .writeHead(status, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify({ code: "BUNDLE_NOT_FOUND", message }));

/**
 * GET `/api/v1/agent-bundle/install.sh` и `/api/v1/agent-bundle/<os>-<arch>.tar.gz`
 * (без входа: в архиве нет секретов). `false` — не этот путь.
 */
export const serveBundle = (
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
): boolean => {
  const path = (req.url ?? "/").split("?")[0];

  if (!path.startsWith(`${BUNDLE_PATH}/`)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "только GET");

    return true;
  }
  const name = path.slice(BUNDLE_PATH.length + 1);

  if (name === "install.sh") {
    res
      .writeHead(200, { "content-type": "text/x-shellscript; charset=utf-8" })
      .end(installScript(baseUrl));

    return true;
  }
  const platform = RE_PLATFORM.exec(name);
  const file =
    platform &&
    agentConfig.bundleDir &&
    bundleFile(agentConfig.bundleDir, platform[1], platform[2]);

  if (!file) {
    send(
      res,
      404,
      `нет архива агента ${name} (AGENT_BUNDLE_DIR, yarn agent:pack)`,
    );

    return true;
  }
  res.writeHead(200, {
    "content-type": "application/gzip",
    "content-length": String(statSync(file).size),
    "content-disposition": `attachment; filename="${file.split("/").pop()}"`,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);

  return true;
};
