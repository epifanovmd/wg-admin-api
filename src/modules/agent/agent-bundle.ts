import { LINK_PATH, sendJSON } from "agent-sdk/server";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import type { IncomingMessage, ServerResponse } from "http";
import { join } from "path";

/**
 * Установка узлов из архива папки агента (`agent pack`): установщик агента
 * (`install.sh` из его релиза, лежит в каталоге архивов) и новейший архив под
 * платформу узла. Публично: секретов в архивах нет (файлы переменных — только
 * в архивах `agent pack --with-env`, их не раздают).
 */
export const BUNDLE_PATH = `${LINK_PATH}/bundle`;

// Архивы под Linux — для узлов; под macOS — для разработки (agent run из архива).
const PLATFORM = /^(linux|darwin)-(amd64|arm64)\.tar\.gz$/;
const ARCHIVE =
  /^agent-[a-z0-9-]+-[0-9][^/]*-(linux|darwin)-(amd64|arm64)\.tar\.gz$/;

/** Адрес установщика: `<сервер>/api/v1/agent-link/bundle/install.sh`. */
export const bundleInstallUrl = (server: string): string =>
  `${server.replace(/\/+$/, "")}${BUNDLE_PATH}/install.sh`;

/** Адрес архива для `install.sh --bundle`: `{arch}` установщик заменяет на amd64 или arm64. */
export const bundleArchiveUrl = (server: string): string =>
  `${server.replace(/\/+$/, "")}${BUNDLE_PATH}/linux-{arch}.tar.gz`;

/**
 * Флаги установщика для установки из архива этого сервера: адрес сервера и
 * архива; экземпляр, воркеры, пакеты и права — в настройках архива.
 */
export const bundleInstallFlags = (server: string): string[] => [
  "--server",
  server.replace(/\/+$/, ""),
  "--bundle",
  bundleArchiveUrl(server),
];

/** Новейший архив под платформу в каталоге архивов. */
const newestArchive = async (
  dir: string,
  os: string,
  arch: string,
): Promise<{ path: string; size: number } | null> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  let best: { path: string; size: number; mtime: number } | null = null;

  for (const name of names) {
    const match = ARCHIVE.exec(name);

    if (match?.[1] !== os || match[2] !== arch) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);

    if (info && (!best || info.mtimeMs > best.mtime)) {
      best = { path, size: info.size, mtime: info.mtimeMs };
    }
  }

  return best && { path: best.path, size: best.size };
};

const sendFile = (
  req: IncomingMessage,
  res: ServerResponse,
  file: { path: string; size: number },
  type: string,
): true => {
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": file.size,
    "Content-Disposition": `attachment; filename="${file.path.split("/").pop()}"`,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file.path).pipe(res);

  return true;
};

/**
 * GET и HEAD `bundle/install.sh` и `bundle/<os>-<arch>.tar.gz` из каталога
 * архивов `dir`; не наш путь или каталога нет — false.
 */
export const serveBundle = async (
  dir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> => {
  if (
    !dir ||
    (req.method !== "GET" && req.method !== "HEAD") ||
    !path.startsWith(`${BUNDLE_PATH}/`)
  ) {
    return false;
  }
  const name = path.slice(BUNDLE_PATH.length + 1);
  const platform = PLATFORM.exec(name);
  let file: { path: string; size: number } | null = null;

  if (name === "install.sh") {
    const script = join(dir, "install.sh");
    const info = await stat(script).catch(() => null);

    file = info && { path: script, size: info.size };
  } else if (platform) {
    file = await newestArchive(dir, platform[1], platform[2]);
  }
  if (!file) {
    sendJSON(res, 404, {
      code: "NOT_FOUND",
      message: `нет ${name} в каталоге архивов агента (AGENT_BUNDLE_DIR)`,
    });

    return true;
  }

  return sendFile(
    req,
    res,
    file,
    name === "install.sh"
      ? "text/x-shellscript; charset=utf-8"
      : "application/gzip",
  );
};
