import { execFileSync } from "child_process";
import { generateKeyPairSync } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * Сборки для сценариев с настоящим агентом — без GitHub:
 *
 * - **агент** — сборки агента с GitHub, скачанные заранее
 *   (`yarn agent:fetch [версия]` → `agent/dist/v<версия>`; другой корень —
 *   `E2E_AGENT_DIST`). Стенд раздаёт их своим HTTP-сервером как каталог
 *   сборок агента (как релизы на GitHub, `AGENT_CATALOG_URL`): из него агент
 *   берёт новую версию сам (`update.releases`), `agent pack` — программу
 *   агента для архива;
 * - **архив папки агента** — `agent pack` этой программой агента под эту
 *   машину во временный `AGENT_BUNDLE_DIR`: воркеры wg и socks собирает их
 *   `build` (Go на машине или в контейнере), сборки в `release/` подписаны
 *   ключом проекта стенда.
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

/**
 * Прежняя версия агента — для обновления агента (`yarn agent:fetch 1.4.0`):
 * новую версию в своём каталоге сборок агент находит сам с 1.2.
 */
export const AGENT_PREVIOUS_VERSION = env.E2E_AGENT_PREVIOUS_VERSION ?? "1.4.0";

const distRoot = resolve(env.E2E_AGENT_DIST ?? "agent/dist");

/** Каталог сборок агента версии `version` (с GitHub). */
export const agentDist = (version: string): string =>
  join(distRoot, `v${version}`);

/** Программа агента версии `version` под эту машину; нет — `null`. */
export const agentBinary = (version: string): string | null => {
  const file = join(agentDist(version), `agent-${PLATFORM}`);

  return existsSync(file) ? file : null;
};

/** Ключ проекта стенда (Ed25519): им подписаны воркеры wg и socks. */
const projectKey = generateKeyPairSync("ed25519");

/** Открытый ключ проекта стенда (base64) — `AGENT_UPDATE_PUBLIC_KEY`. */
export const PROJECT_PUBLIC_KEY = Buffer.from(
  projectKey.publicKey.export({ format: "jwk" }).x!,
  "base64url",
).toString("base64");

/** Закрытый ключ проекта стенда для agent pack (`AGENT_SIGNING_KEY`: seed, base64). */
const signingKey = Buffer.from(
  projectKey.privateKey.export({ format: "jwk" }).d!,
  "base64url",
).toString("base64");

/** Архивы папки агента стенда (`AGENT_BUNDLE_DIR`); создаёт `prepare`. */
export let BUNDLE_DIR = "";

/** Сборки воркеров wg и socks стенда: `release/` архивов. */
export const projectReleasesDir = (): string => join(BUNDLE_DIR, "release");

/** Есть ли всё для сценариев с настоящим агентом. */
export const realAgentAvailable = (): boolean =>
  !!agentBinary(AGENT_VERSION) &&
  existsSync(join(agentDist(AGENT_VERSION), "manifest.json")) &&
  !!BUNDLE_DIR &&
  existsSync(join(projectReleasesDir(), "manifest.json"));

/**
 * Каталог сборок агента на сервере стенда (как релизы на GitHub:
 * `<url>/latest/download/<файл>`, `<url>/download/v<версия>/<файл>`).
 */
export let AGENT_CATALOG_URL = "";

/** Запросы к каталогу сборок агента (пути). */
export const mirrorRequests: string[] = [];

let mirror: Server | undefined;

/**
 * Архив папки агента под эту машину — `agent pack` программой агента этой версии
 * (воркеры wg и socks собирает их build), сборки подписаны ключом стенда.
 * Не вышло (нет Go и Docker) — пусто: сценарии с настоящим агентом
 * пропускаются.
 */
const packBundle = (catalogUrl: string): string => {
  const binary = agentBinary(AGENT_VERSION);

  if (!binary || !catalogUrl) return "";
  const dir = mkdtempSync(join(tmpdir(), "e2e-wg-bundle-"));
  const [os, arch] = PLATFORM.split("-");

  try {
    execFileSync(
      binary,
      [
        "pack",
        "--env",
        "prod",
        "--platform",
        `${os}/${arch}`,
        "--out",
        dir,
        "--release-out",
        join(dir, "release"),
      ],
      {
        cwd: resolve("agent"),
        env: {
          ...env,
          AGENT_SIGNING_KEY: signingKey,
          AGENT_UPDATE_RELEASES: catalogUrl,
          AGENT_NO_UPDATE_CHECK: "1",
        },
        stdio: "pipe",
      },
    );
  } catch (err) {
    process.stderr.write(
      `E2E: agent pack не удался — сценарии с настоящим агентом пропускаются\n${String(err)}\n`,
    );
    rmSync(dir, { recursive: true, force: true });

    return "";
  }
  // Установщик агента — рядом с архивами, как у yarn agent:pack.
  const installer = join(agentDist(AGENT_VERSION), "install.sh");

  if (existsSync(installer)) copyFileSync(installer, join(dir, "install.sh"));

  return dir;
};

/** Статический сервер каталога сборок агента: файл — по последнему сегменту пути. */
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

  return `http://127.0.0.1:${port}`;
};

/**
 * Сборки стенда до запуска сервера: каталог сборок агента и архивы папки
 * агента; результат — окружение бэкенда. Без скачанных сборок агента
 * каталога нет (стенд не ходит в GitHub).
 */
export const prepareAgentReleases = async (): Promise<
  Record<string, string>
> => {
  const dist = agentDist(AGENT_VERSION);

  AGENT_CATALOG_URL = existsSync(join(dist, "manifest.json"))
    ? await serve(dist)
    : "";
  BUNDLE_DIR = packBundle(AGENT_CATALOG_URL);
  mirrorRequests.length = 0;

  return { AGENT_BUNDLE_DIR: BUNDLE_DIR };
};

export const closeAgentReleases = async (): Promise<void> => {
  if (mirror) {
    mirror.closeAllConnections();
    await new Promise<void>(r => mirror!.close(() => r()));
    mirror = undefined;
  }
  if (BUNDLE_DIR) rmSync(BUNDLE_DIR, { recursive: true, force: true });
};
