import { ChildProcess, execFile, spawn } from "child_process";
import { generateKeyPairSync } from "crypto";
import { once } from "events";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { readFile } from "fs/promises";
import { createServer as createHttpServer, Server } from "http";
import { Redis } from "ioredis";
import { AddressInfo, createServer } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Client } from "pg";
import { promisify } from "util";

/**
 * Интеграционный стенд: настоящий сервер (`APP_ROLE=all`) поверх Postgres,
 * Redis и SMTP (Mailpit). Параметры — из окружения E2E_*, по умолчанию —
 * сервисы `docker-compose.dev.yml` (`yarn services:up`).
 */
const env = process.env;

export const E2E = {
  db: {
    host: env.E2E_POSTGRES_HOST ?? "localhost",
    port: Number(env.E2E_POSTGRES_PORT ?? 5434),
    user: env.E2E_POSTGRES_USER ?? "postgres",
    password: env.E2E_POSTGRES_PASSWORD ?? "postgres",
    database: env.E2E_POSTGRES_DB ?? "wg_admin_e2e",
  },
  redisUrl: env.E2E_REDIS_URL ?? "redis://localhost:6381/15",
  /** Префикс ключей стенда в общем Redis (доступ по префиксу); пусто — отдельная база. */
  redisKeyPrefix: env.E2E_REDIS_KEY_PREFIX ?? "",
  smtp: {
    host: env.E2E_SMTP_HOST ?? "localhost",
    port: env.E2E_SMTP_PORT ?? "1027",
  },
  mailpitUrl: env.E2E_MAILPIT_URL ?? "http://localhost:8027",
  admin: { email: "admin@e2e.local", password: "admin-e2e-password" },
};

/**
 * Свободные порты, все разные: слушатели держатся, пока не выбраны все, —
 * иначе два вызова подряд могут получить один и тот же порт.
 */
const freePorts = async (count: number): Promise<number[]> => {
  const servers = Array.from({ length: count }, () => createServer().listen(0));

  await Promise.all(servers.map(server => once(server, "listening")));
  const ports = servers.map(
    server => (server.address() as { port: number }).port,
  );

  await Promise.all(
    servers.map(server => new Promise(done => server.close(done))),
  );

  return ports;
};

/**
 * Стенд очищает БД — только с именем, где явно есть «e2e» или «test»: защита от
 * запуска против рабочей базы. Базы нет — создаётся (нужен CREATEDB); есть —
 * пересоздаются её схемы, на что хватает прав владельца базы.
 */
const resetDatabase = async (): Promise<void> => {
  const { database } = E2E.db;

  if (!/e2e|test/i.test(database)) {
    throw new Error(`E2E: база «${database}» не похожа на тестовую — отказ`);
  }

  const db = new Client(E2E.db);

  try {
    await db.connect();
  } catch (error) {
    if ((error as { code?: string }).code !== "3D000") throw error;
    const admin = new Client({ ...E2E.db, database: "postgres" });

    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();

    return;
  }

  try {
    const { rows } = await db.query<{ name: string; owner: string }>(
      `SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`,
    );
    const foreign = rows.filter(
      row => row.owner !== E2E.db.user && row.name !== "public",
    );

    if (foreign.length) {
      throw new Error(
        `E2E: схемы ${foreign.map(row => `${row.name} (${row.owner})`).join(", ")} базы «${database}» — не роли ${E2E.db.user}: удалите их администратором`,
      );
    }
    for (const { name } of rows) {
      await db.query(`DROP SCHEMA "${name}" CASCADE`);
    }
    await db.query("CREATE SCHEMA public");
  } finally {
    await db.end();
  }
};

/**
 * Лимиты, присутствие и одноразовые токены живут в Redis — стенд чистит его:
 * ключи своего префикса (общий Redis) или отдельную базу (не `0`) — защита от
 * очистки общего Redis.
 */
const resetRedis = async (): Promise<void> => {
  const prefix = E2E.redisKeyPrefix;
  const db = Number(new URL(E2E.redisUrl).pathname.slice(1) || 0);

  if (!prefix && !db) {
    throw new Error(
      `E2E: Redis ${E2E.redisUrl} — база 0 без префикса, нужна отдельная (/15) или E2E_REDIS_KEY_PREFIX`,
    );
  }

  const redis = new Redis(E2E.redisUrl);

  try {
    if (!prefix) {
      await redis.flushdb();

      return;
    }
    for await (const keys of redis.scanStream({
      match: `${prefix}*`,
      count: 500,
    })) {
      if ((keys as string[]).length) await redis.del(...(keys as string[]));
    }
  } finally {
    redis.disconnect();
  }
};

/** Версия агента: `AGENT_VERSION` окружения, иначе из `.env.example`. */
export const agentVersion = (): string =>
  process.env.AGENT_VERSION ||
  (/^AGENT_VERSION=(\S+)/m.exec(
    readFileSync(resolve(".env.example"), "utf8"),
  )?.[1] ??
    "");

/**
 * Сборки агента с GitHub (`yarn agent:fetch`): программа агента под каждую
 * платформу, `manifest.json`, `install.sh`. По умолчанию — версии `AGENT_VERSION`.
 */
export const AGENT_DIST_DIR = resolve(
  env.E2E_AGENT_DIST_DIR ?? `agent/dist/v${agentVersion()}`,
);

/** Версия сборок агента стенда — из их `manifest.json`. */
export const AGENT_VERSION = existsSync(join(AGENT_DIST_DIR, "manifest.json"))
  ? (
      JSON.parse(
        readFileSync(join(AGENT_DIST_DIR, "manifest.json"), "utf8"),
      ) as { version: string }
    ).version
  : agentVersion();

/** Агенты стенда: общий токен регистрации. */
export const AGENT_BOOTSTRAP_TOKEN = "e2e-bootstrap-token-0123456789abcdef0123";

/** Пара ключей проекта (Ed25519, base64): подпись воркеров проекта. */
const projectKeys = (): { signing: string; public: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const b64 = (jwkValue: string | undefined) =>
    Buffer.from(jwkValue ?? "", "base64url").toString("base64");

  return {
    signing: b64(privateKey.export({ format: "jwk" }).d),
    public: b64(publicKey.export({ format: "jwk" }).x),
  };
};

/** Ключи проекта стенда: ими подписаны сборки воркеров проекта. */
export const PROJECT_KEYS = projectKeys();

/** Архивы папки агента стенда (agent pack во временный каталог): AGENT_BUNDLE_DIR. */
let bundleDir = "";

/** Каталог архивов папки агента стенда (в нём `release/` — сборки воркеров проекта). */
export const agentBundleDir = (): string => bundleDir;

export interface IAgentReleases {
  /** Адрес каталога сборок агента (как релизы GitHub: `…/download/v<версия>`). */
  url: string;
  close: () => Promise<void>;
}

/**
 * Каталог сборок агента (как релизы GitHub): файлы `AGENT_DIST_DIR`. Из него
 * `agent pack` стенда берёт программу агента под платформу архива.
 */
const serveAgentReleases = async (dir: string): Promise<IAgentReleases> => {
  if (!existsSync(join(dir, "manifest.json"))) {
    throw new Error(`E2E: нет сборок агента в ${dir} — yarn agent:fetch`);
  }
  const http: Server = createHttpServer(async (req, res) => {
    const name = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");

    try {
      const body = await readFile(join(dir, name));

      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  http.listen(0, "127.0.0.1");
  await once(http, "listening");

  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/download/v${AGENT_VERSION}`,
    close: () =>
      new Promise<void>(done => {
        http.closeAllConnections();
        http.close(() => done());
      }),
  };
};

let agentReleases: IAgentReleases | undefined;

/** Платформа этой машины в именах сборок агента: darwin-arm64, linux-amd64. */
const hostPlatform = (): { os: string; arch: string } => ({
  os: process.platform === "darwin" ? "darwin" : "linux",
  arch: process.arch === "arm64" ? "arm64" : "amd64",
});

/**
 * Архив папки агента под эту машину и сборки воркеров проекта (`release/`),
 * подписанные ключом проекта стенда — как `yarn agent:pack`; программа агента —
 * с локального каталога сборок агента.
 */
const buildProjectBundle = async (releases: string): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-agent-bundle-"));
  const { os, arch } = hostPlatform();
  const agentBin =
    env.E2E_AGENT_BIN ?? join(AGENT_DIST_DIR, `agent-${os}-${arch}`);

  await promisify(execFile)(
    agentBin,
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
        AGENT_SIGNING_KEY: PROJECT_KEYS.signing,
        AGENT_UPDATE_RELEASES: releases.replace(/\/download\/v[^/]+$/, ""),
        AGENT_NO_UPDATE_CHECK: "1",
      },
    },
  );
  // Установщик агента — рядом с архивами, как у yarn agent:pack.
  copyFileSync(join(AGENT_DIST_DIR, "install.sh"), join(dir, "install.sh"));

  return dir;
};

let server: ChildProcess | undefined;

export let BASE_URL = "";

/** Окружение копии API на порту `port` (имя копии — `http://127.0.0.1:<port>`). */
const serverEnv = (port: number): NodeJS.ProcessEnv => ({
  ...env,
  NODE_ENV: "test",
  APP_ROLE: "all",
  APP_PUBLIC_URL: BASE_URL,
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: String(port),
  TRUST_PROXY: "true",
  API_DOCS_ENABLED: "true",
  SHUTDOWN_DRAIN_MS: "0",
  LOG_LEVEL: env.E2E_LOG_LEVEL ?? "warn",
  RATE_LIMIT: "100000",
  POSTGRES_HOST: E2E.db.host,
  POSTGRES_PORT: String(E2E.db.port),
  POSTGRES_USER: E2E.db.user,
  POSTGRES_PASSWORD: E2E.db.password,
  POSTGRES_DB: E2E.db.database,
  REDIS_URL: E2E.redisUrl,
  REDIS_KEY_PREFIX: E2E.redisKeyPrefix,
  SMTP_HOST: E2E.smtp.host,
  SMTP_PORT: E2E.smtp.port,
  SMTP_SECURE: "false",
  SMTP_FROM: "no-reply@e2e.local",
  JWT_SECRET_KEY: "e2e-secret-key-0123456789abcdef0123456789",
  ADMIN_EMAIL: E2E.admin.email,
  ADMIN_PASSWORD: E2E.admin.password,
  AGENT_BOOTSTRAP_TOKEN,
  AGENT_BUNDLE_DIR: bundleDir,
  AGENT_STATE_INTERVAL_MS: "1000",
  AGENT_METRICS_INTERVAL_MS: "1000",
  AGENT_METRICS_STORE_INTERVAL_MS: "0",
});

/** Запустить копию API и дождаться готовности. */
const spawnServer = async (port: number): Promise<ChildProcess> => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv(port),
  });
  const logs: string[] = [];

  child.stdout?.on("data", chunk => logs.push(String(chunk)));
  child.stderr?.on("data", chunk => logs.push(String(chunk)));
  // Журнал копии API в файл — разбирать падения сценариев.
  if (env.E2E_SERVER_LOG) {
    const file = createWriteStream(`${env.E2E_SERVER_LOG}.${port}`, {
      flags: "a",
    });

    child.stdout?.pipe(file);
    child.stderr?.pipe(file);
  }

  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).status === 200) {
        return child;
      }
    } catch {
      // сервер ещё поднимается
    }
    await new Promise(r => setTimeout(r, 500));
  }

  child.kill("SIGKILL");
  throw new Error(`E2E: сервер не стал готов\n${logs.join("").slice(-4000)}`);
};

export const startServer = async (): Promise<void> => {
  await resetDatabase();
  await resetRedis();
  agentReleases = await serveAgentReleases(AGENT_DIST_DIR);
  bundleDir = await buildProjectBundle(agentReleases.url);

  const [port] = await freePorts(1);

  BASE_URL = `http://127.0.0.1:${port}`;
  server = await spawnServer(port);
};

/** Вторая копия API над той же БД и Redis (без соединений агентов). */
export const startPeerServer = async (): Promise<{
  url: string;
  stop: () => Promise<void>;
}> => {
  const [port] = await freePorts(1);
  const child = await spawnServer(port);

  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
};

export const stopServer = async (): Promise<void> => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await agentReleases?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
};
