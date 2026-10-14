import { readFile } from "fs/promises";
import { basename } from "path";
import { gunzipSync, gzipSync } from "zlib";

import { agentConfig } from "./agent.config";
import { newestBundleArchive } from "./agent-files";

/** Папка агента в архиве (`agent pack`). */
const ARCHIVE_ROOT = "agent";

/** Файл переменных получателя в архиве: его читают настройки (`envFiles`) и compose.yml. */
export const AGENT_ARCHIVE_ENV_FILE = ".env";

const BLOCK = 512;

/** Переменные агента для `.env` получателя. */
export interface IAgentEnvValues {
  server: string;
  token: string;
  /** Имя агента на бэкенде; нет — имя машины. */
  name?: string;
}

/** `http://` — агенту нужно явное разрешение связи без шифрования. */
export const isInsecureServer = (server: string): boolean =>
  /^http:\/\//i.test(server);

/** Значение для `.env`: без переводов строк, в кавычках, если нужно. */
const envValue = (value: string): string => {
  const clean = value.replace(/[\r\n]/g, "");

  return /^[A-Za-z0-9_./:@+-]*$/.test(clean)
    ? clean
    : `"${clean.replace(/["\\$`]/g, "\\$&")}"`;
};

/**
 * Текст `.env` получателя архива: адрес бэкенда, токен регистрации, имя; для `http://` —
 * разрешение связи без шифрования.
 */
export const agentEnvText = (values: IAgentEnvValues): string => {
  const lines = [
    "# Агент: адрес бэкенда и токен регистрации (нужен только до первой регистрации).",
    `AGENT_SERVER_URL=${envValue(values.server)}`,
    `AGENT_ENROLL_TOKEN=${envValue(values.token)}`,
  ];

  if (values.name) lines.push(`AGENT_NAME=${envValue(values.name)}`);
  if (isInsecureServer(values.server)) {
    lines.push(
      "# http:// — ключ агента и данные идут открытым текстом.",
      "AGENT_SERVER_ALLOW_INSECURE=true",
    );
  }

  return `${lines.join("\n")}\n`;
};

const octal = (value: number, width: number): string =>
  `${value.toString(8).padStart(width - 1, "0")}\0`;

/** Заголовок ustar обычного файла. */
const tarHeader = (path: string, size: number, mode: number): Buffer => {
  const header = Buffer.alloc(BLOCK);

  header.write(path, 0, 100, "utf8");
  header.write(octal(mode, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let sum = 0;

  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

  return header;
};

/**
 * Записи tar: имена; `end` — начало завершающих нулевых блоков; `read` — содержимое записи с
 * этим именем (если просили).
 */
const tarEntries = (
  tar: Buffer,
  read?: string,
): { names: string[]; end: number; content?: Buffer } => {
  const names: string[] = [];
  let content: Buffer | undefined;
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    if (header.every(byte => byte === 0)) break;
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/s, "");
    const size = parseInt(
      header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0",
      8,
    );

    const full = prefix ? `${prefix}/${name}` : name;

    names.push(full);
    if (read && (full === read || full === `./${read}`)) {
      content = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    }
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }

  return { names, end: offset, content };
};

/**
 * Архив `.tar.gz` с ещё одним файлом (права `mode`): прежние записи как есть, новая — перед
 * концом архива. Файл с тем же путём в архиве — ошибка.
 */
export const appendToTarGz = (
  archive: Buffer,
  path: string,
  content: string,
  mode: number,
): Buffer => {
  const tar = gunzipSync(archive);
  const { names, end } = tarEntries(tar);

  if (names.includes(path) || names.includes(`./${path}`)) {
    throw new Error(`в архиве уже есть ${path}`);
  }
  const data = Buffer.from(content, "utf8");
  const padding = Buffer.alloc(
    Math.ceil(data.length / BLOCK) * BLOCK - data.length,
  );

  return gzipSync(
    Buffer.concat([
      tar.subarray(0, end),
      tarHeader(path, data.length, mode),
      data,
      padding,
      Buffer.alloc(BLOCK * 2),
    ]),
  );
};

/** Архив агента для узлов (все платформы) и что в нём. */
export interface IAgentArchiveInfo {
  file: string;
  /** Версия агента (`bundle.json` архива). */
  version: string | null;
  /** Платформы архива: `linux/amd64`, `linux/arm64` (`bundle.json`). */
  platforms: string[];
  size: number;
  /** В архиве есть `compose.yml` (запуск в Docker Compose). */
  compose: boolean;
}

let infoCache: { path: string; mtime: number; info: IAgentArchiveInfo } | null =
  null;

/** Новейший архив агента для узлов (`AGENT_BUNDLE_DIR`); нет — `null`. */
export const agentArchive = async (): Promise<IAgentArchiveInfo | null> => {
  const dir = agentConfig.bundleDir;
  const file = dir ? await newestBundleArchive(dir) : null;

  if (!file) return null;
  if (infoCache?.path === file.path && infoCache.mtime === file.mtime) {
    return infoCache.info;
  }
  const { names, content } = tarEntries(
    gunzipSync(await readFile(file.path)),
    `${ARCHIVE_ROOT}/bundle.json`,
  );
  const bundle = JSON.parse(content?.toString("utf8") ?? "{}") as {
    version?: string;
    platforms?: string[];
  };
  const info: IAgentArchiveInfo = {
    file: basename(file.path),
    version: bundle.version ?? null,
    platforms: bundle.platforms ?? [],
    size: file.size,
    compose: names.some(
      n => n === `${ARCHIVE_ROOT}/compose.yml` || n === "./agent/compose.yml",
    ),
  };

  infoCache = { path: file.path, mtime: file.mtime, info };

  return info;
};

/**
 * Архив агента с `.env` получателя (права 0600): тот же архив, что раздаётся всем, и файл
 * переменных с адресом и токеном. `null` — архива нет.
 */
export const agentArchiveWithEnv = async (
  values: IAgentEnvValues,
): Promise<{ file: string; data: Buffer } | null> => {
  const dir = agentConfig.bundleDir;
  const file = dir ? await newestBundleArchive(dir) : null;

  if (!file) return null;

  return {
    file: basename(file.path),
    data: appendToTarGz(
      await readFile(file.path),
      `${ARCHIVE_ROOT}/${AGENT_ARCHIVE_ENV_FILE}`,
      agentEnvText(values),
      0o600,
    ),
  };
};
