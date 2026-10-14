import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import type { IncomingMessage, ServerResponse } from "http";
import { basename, join } from "path";

import { config } from "../../config";
import { agentConfig, agentReleasesDir } from "./agent.config";
import { AGENT_PROTOCOL_PREFIX } from "./protocol";

/** Архив для узлов: `install.sh` и `agent.tar.gz` (новейший архив agent pack, все платформы). */
export const AGENT_BUNDLE_PATH = `${AGENT_PROTOCOL_PREFIX}/bundle`;

/** Каталог сборок воркеров проекта: `manifest.json` и файлы сборок. */
export const AGENT_RELEASES_PATH = `${AGENT_PROTOCOL_PREFIX}/releases`;

/** Имя архива в адресе раздачи. */
export const BUNDLE_ARCHIVE_NAME = "agent.tar.gz";
const ARCHIVE = /^agent-[a-z0-9-]+-[0-9][^/]*\.tar\.gz$/;
const RELEASE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Адрес бэкенда для агентов: `AGENT_PUBLIC_URL`, иначе `APP_PUBLIC_URL`. */
export const agentPublicUrl = (): string =>
  (agentConfig.publicUrl ?? config.app.publicUrl).replace(/\/+$/, "");

/** Адрес установщика: `<сервер>/agent/v1/bundle/install.sh`. */
export const bundleInstallUrl = (server: string): string =>
  `${server.replace(/\/+$/, "")}${AGENT_BUNDLE_PATH}/install.sh`;

/** Адрес архива агента (все платформы): `<сервер>/agent/v1/bundle/agent.tar.gz`. */
export const bundleArchiveUrl = (server: string): string =>
  `${server.replace(/\/+$/, "")}${AGENT_BUNDLE_PATH}/${BUNDLE_ARCHIVE_NAME}`;

/** Флаги установщика для установки из архива этого сервера. */
export const bundleInstallFlags = (server: string): string[] => [
  "--server",
  server.replace(/\/+$/, ""),
  "--bundle",
  bundleArchiveUrl(server),
];

/**
 * Способ установки: служба (root), служба пользователя, без установки (свой менеджер процессов),
 * Docker Compose из архива (`compose.yml` архива).
 */
export type TAgentInstallMode = "systemd" | "rootless" | "run" | "docker";

/** Значение для shell в одинарных кавычках. */
const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Команда установки агента на узел из архива этого сервера: `install.sh` скачивает архив под
 * платформу узла (настройки, воркеры — из архива) и ставит агента с токеном. Значения — в
 * кавычках.
 */
export const agentInstallCommand = (options: {
  token?: string;
  tokenFile?: string;
  name?: string;
  mode?: TAgentInstallMode;
  server?: string;
}): string => {
  const server = (options.server ?? agentPublicUrl()).replace(/\/+$/, "");

  if (options.mode === "docker")
    return agentDockerCommand({ ...options, server });
  const flags = [
    "--server",
    shellQuote(server),
    "--bundle",
    shellQuote(bundleArchiveUrl(server)),
  ];

  if (options.token) flags.push("--token", shellQuote(options.token));
  if (options.tokenFile)
    flags.push("--token-file", shellQuote(options.tokenFile));
  if (options.name) flags.push("--name", shellQuote(options.name));
  if (options.mode === "rootless") flags.push("--rootless");
  if (options.mode === "run") flags.push("--run");
  const sudo = options.mode === "systemd" || !options.mode ? "sudo " : "";

  return `curl -fsSL ${shellQuote(bundleInstallUrl(server))} | ${sudo}sh -s -- ${flags.join(" ")}`;
};

/**
 * Команда запуска агента в Docker Compose из архива этого сервера (все платформы — образ под
 * платформу машины), `.env` с адресом, токеном и именем (0600; без имени — имя машины, а не
 * контейнера), `docker compose up -d --build` по `compose.yml` архива (каталог `agent/` в текущем).
 */
const agentDockerCommand = (options: {
  token?: string;
  name?: string;
  server: string;
}): string => {
  const env = [
    `AGENT_SERVER_URL=${options.server}`,
    `AGENT_ENROLL_TOKEN=${options.token ?? ""}`,
    ...(/^http:\/\//i.test(options.server)
      ? ["AGENT_SERVER_ALLOW_INSECURE=true"]
      : []),
  ].map(shellQuote);

  // Имя агента: заданное, иначе — имя машины (у контейнера своё имя, оно меняется).
  env.push(
    options.name
      ? shellQuote(`AGENT_NAME=${options.name}`)
      : `"AGENT_NAME=$(hostname)"`,
  );

  return [
    `curl -fsSL ${shellQuote(bundleArchiveUrl(options.server))} | tar -xz`,
    "cd agent",
    `(umask 077 && printf '%s\\n' ${env.join(" ")} > .env)`,
    "docker compose up -d --build",
  ].join(" && ");
};

/** Новейший архив agent pack в каталоге архивов (по времени изменения). */
export const newestBundleArchive = async (
  dir: string,
): Promise<{ path: string; size: number; mtime: number } | null> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  let best: { path: string; size: number; mtime: number } | null = null;

  for (const name of names) {
    if (!ARCHIVE.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);

    if (info && (!best || info.mtimeMs > best.mtime)) {
      best = { path, size: info.size, mtime: info.mtimeMs };
    }
  }

  return best;
};

const fileIn = async (
  dir: string,
  name: string,
): Promise<{ path: string; size: number } | null> => {
  const path = join(dir, name);
  const info = await stat(path).catch(() => null);

  return info?.isFile() ? { path, size: info.size } : null;
};

const sendFile = (
  req: IncomingMessage,
  res: ServerResponse,
  file: { path: string; size: number },
  type: string,
): void => {
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": file.size,
    "Content-Disposition": `attachment; filename="${basename(file.path)}"`,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file.path).pipe(res);
};

const notFound = (res: ServerResponse, message: string): void => {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: "NOT_FOUND", message }));
};

const contentType = (name: string): string => {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".sh")) return "text/x-shellscript; charset=utf-8";
  if (name.endsWith(".tar.gz")) return "application/gzip";

  return "application/octet-stream";
};

/**
 * GET/HEAD архивов для узлов и каталога сборок воркеров (публично: секретов в них нет —
 * архивы с переменными окружения `agent pack --with-env` здесь не раздаются). Не наш путь —
 * `false`.
 */
export const serveAgentFiles = async (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> => {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  if (path.startsWith(`${AGENT_BUNDLE_PATH}/`)) {
    const dir = agentConfig.bundleDir;
    const name = path.slice(AGENT_BUNDLE_PATH.length + 1);
    let file: { path: string; size: number } | null = null;

    if (dir && name === "install.sh") file = await fileIn(dir, name);
    else if (dir && name === BUNDLE_ARCHIVE_NAME)
      file = await newestBundleArchive(dir);
    if (!file)
      notFound(res, `нет ${name} в каталоге архивов агента (AGENT_BUNDLE_DIR)`);
    else sendFile(req, res, file, contentType(name));

    return true;
  }

  if (path.startsWith(`${AGENT_RELEASES_PATH}/`)) {
    const dir = agentReleasesDir();
    const name = path.slice(AGENT_RELEASES_PATH.length + 1);
    const file =
      dir && RELEASE_FILE.test(name) ? await fileIn(dir, name) : null;

    if (!file) notFound(res, `нет ${name} в каталоге сборок воркеров`);
    else sendFile(req, res, file, contentType(name));

    return true;
  }

  return false;
};
