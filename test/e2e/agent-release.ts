import { createHash, generateKeyPairSync, sign } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * Выпуск для сценариев с настоящим агентом — без GitHub:
 *
 * - **агент и netprobe** — каталог выпуска с GitHub, скачанный заранее
 *   (`agent/fetch-agent.sh` → `agent/dist/agent-<версия>`; другой корень —
 *   `E2E_AGENT_DIST`). Стенд раздаёт его своим HTTP-сервером, бэкенд берёт
 *   его как базу выпуска (`AGENT_RELEASES_URL`);
 * - **воркеры проекта** wg и socks — сборки под эту машину из `agent/release`
 *   или `agent/dist` (`yarn agent:release`, `scripts/go-agent.sh build`;
 *   другой каталог — `E2E_WORKERS_DIR`). Стенд подписывает их своим ключом
 *   проекта и пишет `manifest.json` во временный `AGENT_RELEASES_DIR`.
 *
 * Чего нет — сценарии с настоящим агентом пропускаются.
 */
const env = process.env;

export const PLATFORM = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "amd64"}`;

/** Версия агента — версия agent-sdk бэкенда. */
export const AGENT_VERSION = (
  JSON.parse(
    readFileSync(resolve("node_modules/agent-sdk/package.json"), "utf8"),
  ) as { version: string }
).version;

/** Прежняя версия агента — для обновления агента (`agent/fetch-agent.sh 1.0.1`). */
export const AGENT_PREVIOUS_VERSION = env.E2E_AGENT_PREVIOUS_VERSION ?? "1.0.1";

const distRoot = resolve(env.E2E_AGENT_DIST ?? "agent/dist");

/** Каталог выпуска агента версии `version` (с GitHub). */
export const agentDist = (version: string): string =>
  join(distRoot, `agent-${version}`);

/** Программа агента версии `version` под эту машину; нет — `null`. */
export const agentBinary = (version: string): string | null => {
  const file = join(agentDist(version), `agent-${PLATFORM}`);

  return existsSync(file) ? file : null;
};

const PROJECT_WORKERS = ["wg", "socks"] as const;

const workerVersion = (name: string): string =>
  readFileSync(resolve(`agent/workers/${name}/VERSION`), "utf8").trim();

/** Сборка воркера проекта под эту машину; нет — `null`. */
export const workerBuild = (name: string): string | null => {
  const file = `${name}-${workerVersion(name)}-${PLATFORM}`;
  const dirs = env.E2E_WORKERS_DIR
    ? [env.E2E_WORKERS_DIR]
    : ["agent/release", "agent/dist"];

  return (
    dirs.map(dir => resolve(dir, file)).find(path => existsSync(path)) ?? null
  );
};

/** Есть ли всё для сценариев с настоящим агентом. */
export const realAgentAvailable = (): boolean =>
  !!agentBinary(AGENT_VERSION) &&
  existsSync(join(agentDist(AGENT_VERSION), "manifest.json")) &&
  PROJECT_WORKERS.every(name => !!workerBuild(name));

/** Ключ проекта стенда (Ed25519): им подписаны воркеры wg и socks. */
const projectKey = generateKeyPairSync("ed25519");

/** Открытый ключ проекта стенда (base64) — `AGENT_UPDATE_PUBLIC_KEY`. */
export const PROJECT_PUBLIC_KEY = Buffer.from(
  projectKey.publicKey.export({ format: "jwk" }).x!,
  "base64url",
).toString("base64");

/** Подпись сборки (§11 спецификации агента): Ed25519, base64. */
const signBuild = (
  name: string,
  version: string,
  os: string,
  arch: string,
  sha256: string,
): string =>
  sign(
    null,
    Buffer.from(
      ["agent-release/1", name, version, os, arch, sha256].join("\n"),
    ),
    projectKey.privateKey,
  ).toString("base64");

/** Ключ автора агента из manifest.json выпуска с GitHub. */
export const authorPublicKey = (): string | undefined =>
  (
    JSON.parse(
      readFileSync(join(agentDist(AGENT_VERSION), "manifest.json"), "utf8"),
    ) as { publicKey?: string }
  ).publicKey;

/** Каталог воркеров проекта стенда; создаёт `prepare`. */
export let PROJECT_RELEASES_DIR = "";

/** База выпуска агента на сервере стенда (`AGENT_RELEASES_URL`). */
export let AGENT_RELEASES_URL = "";

/** Запросы к серверу выпуска агента (пути). */
export const mirrorRequests: string[] = [];

let mirror: Server | undefined;

/** Воркеры проекта с подписью ключом стенда — во временный каталог. */
const writeProjectRelease = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-wg-release-"));
  const [os, arch] = PLATFORM.split("-");
  const workers = PROJECT_WORKERS.flatMap(name => {
    const build = workerBuild(name);

    if (!build) return [];

    const version = workerVersion(name);
    const file = `${name}-${version}-${PLATFORM}`;
    const sha256 = createHash("sha256")
      .update(readFileSync(build))
      .digest("hex");

    copyFileSync(build, join(dir, file));

    return [
      {
        name,
        version,
        os,
        arch,
        file,
        sha256,
        signature: signBuild(name, version, os, arch, sha256),
        stopTimeout: "30s",
      },
    ];
  });

  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify({ version: "0.0.0-e2e", artifacts: [], workers }, null, 2)}\n`,
  );

  return dir;
};

/** Статический сервер каталога выпуска агента: `<url>/<файл>`. */
const serve = async (dir: string): Promise<string> => {
  mirror = createServer((req, res) => {
    const path = req.url ?? "";

    mirrorRequests.push(path);

    const name = decodeURIComponent(path.split("/").pop() ?? "");
    const file = join(dir, name);

    if (!name || name.includes("..") || !existsSync(file)) {
      res.writeHead(404).end();

      return;
    }

    const body = readFileSync(file);

    res.writeHead(200, { "content-length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>(r => mirror!.listen(0, "127.0.0.1", r));

  const { port } = mirror.address() as AddressInfo;

  return `http://127.0.0.1:${port}/download/v${AGENT_VERSION}`;
};

/**
 * Выпуск стенда до запуска сервера: окружение бэкенда. Без скачанного
 * выпуска агента удалённого источника нет (бэкенд не ходит в GitHub).
 */
export const prepareAgentReleases = async (): Promise<
  Record<string, string>
> => {
  PROJECT_RELEASES_DIR = writeProjectRelease();

  const dist = agentDist(AGENT_VERSION);

  AGENT_RELEASES_URL = existsSync(join(dist, "manifest.json"))
    ? await serve(dist)
    : "";

  return {
    AGENT_RELEASES_DIR: PROJECT_RELEASES_DIR,
    AGENT_RELEASES_GITHUB: "",
    AGENT_RELEASES_URL,
    AGENT_UPDATE_PUBLIC_KEY: PROJECT_PUBLIC_KEY,
  };
};

export const closeAgentReleases = async (): Promise<void> => {
  if (mirror) {
    mirror.closeAllConnections();
    await new Promise<void>(r => mirror!.close(() => r()));
    mirror = undefined;
  }
  if (PROJECT_RELEASES_DIR) {
    rmSync(PROJECT_RELEASES_DIR, { recursive: true, force: true });
  }
};
