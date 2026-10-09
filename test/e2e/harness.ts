import { ChildProcess, spawn } from "child_process";
import { once } from "events";
import { Redis } from "ioredis";
import { createServer } from "net";
import { Client } from "pg";

import { closeAgentReleases, prepareAgentReleases } from "./agent-release";

/**
 * Интеграционный стенд: настоящий сервер (`APP_ROLE=all`) поверх Postgres,
 * Redis и SMTP (Mailpit). Параметры — из окружения E2E_*, по умолчанию —
 * сервисы `docker-compose.dev.yml`.
 */
const env = process.env;

export const E2E = {
  db: {
    host: env.E2E_POSTGRES_HOST ?? "localhost",
    port: Number(env.E2E_POSTGRES_PORT ?? 5432),
    user: env.E2E_POSTGRES_USER ?? "postgres",
    password: env.E2E_POSTGRES_PASSWORD ?? "postgres",
    database: env.E2E_POSTGRES_DB ?? "wg_admin_e2e",
  },
  redisUrl: env.E2E_REDIS_URL ?? "redis://localhost:6379/15",
  smtp: {
    host: env.E2E_SMTP_HOST ?? "localhost",
    port: env.E2E_SMTP_PORT ?? "1025",
  },
  mailpitUrl: env.E2E_MAILPIT_URL ?? "http://localhost:8025",
  admin: { email: "admin@e2e.local", password: "admin-e2e-password" },
};

const freePort = async (): Promise<number> => {
  const server = createServer().listen(0);

  await once(server, "listening");
  const { port } = server.address() as { port: number };

  server.close();

  return port;
};

/**
 * Стенд пересоздаёт БД — только с именем, где явно есть «e2e» или «test»:
 * защита от запуска против рабочей базы.
 */
const resetDatabase = async (): Promise<void> => {
  const { database } = E2E.db;

  if (!/e2e|test/i.test(database)) {
    throw new Error(`E2E: база «${database}» не похожа на тестовую — отказ`);
  }

  const admin = new Client({ ...E2E.db, database: "postgres" });

  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
};

/**
 * Лимиты, присутствие и одноразовые токены живут в Redis — стенд чистит его.
 * Только отдельную базу (не 0): защита от очистки общего Redis.
 */
const resetRedis = async (): Promise<void> => {
  const db = Number(new URL(E2E.redisUrl).pathname.slice(1) || 0);

  if (!db) {
    throw new Error(
      `E2E: Redis ${E2E.redisUrl} — база 0, нужна отдельная (/15)`,
    );
  }

  const redis = new Redis(E2E.redisUrl);

  await redis.flushdb();
  redis.disconnect();
};

/** Общий токен регистрации агентов стенда. */
export const E2E_BOOTSTRAP_TOKEN = "e2e-bootstrap-token-0123456789abcdef";

let server: ChildProcess | undefined;

export let BASE_URL = "";

export const startServer = async (): Promise<void> => {
  await resetDatabase();
  await resetRedis();

  const port = await freePort();
  const releases = await prepareAgentReleases();

  BASE_URL = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
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
      SMTP_HOST: E2E.smtp.host,
      SMTP_PORT: E2E.smtp.port,
      SMTP_SECURE: "false",
      SMTP_FROM: "no-reply@e2e.local",
      JWT_SECRET_KEY: "e2e-secret-key-0123456789abcdef0123456789",
      ADMIN_EMAIL: E2E.admin.email,
      ADMIN_PASSWORD: E2E.admin.password,
      // Агенты: общий токен регистрации, сборки стенда (agent-release.ts:
      // агент — с сервера стенда, не с GitHub; воркеры проекта с подписью
      // ключом стенда), быстрый статус и отметка offline.
      AGENT_BOOTSTRAP_TOKEN: E2E_BOOTSTRAP_TOKEN,
      ...releases,
      AGENT_STATUS_INTERVAL_MS: "2000",
      AGENT_METRICS_INTERVAL_MS: "2000",
      AGENT_OFFLINE_GRACE_MS: "1000",
    },
  });

  const logs: string[] = [];

  server.stdout?.on("data", chunk => logs.push(String(chunk)));
  server.stderr?.on("data", chunk => logs.push(String(chunk)));

  for (let i = 0; i < 120; i += 1) {
    if (server.exitCode !== null) break;
    try {
      if ((await fetch(`${BASE_URL}/ready`)).status === 200) return;
    } catch {
      // сервер ещё поднимается
    }
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`E2E: сервер не стал готов\n${logs.join("").slice(-4000)}`);
};

export const stopServer = async (): Promise<void> => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await closeAgentReleases();
};
