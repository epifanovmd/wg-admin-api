#!/usr/bin/env node
// Агент на машине разработчика: программа agent/agent той же версии, что agent-sdk в package.json
// (нет — скачивается с GitHub со сверкой sha256), порт API и токен регистрации — из .env.development
// (тот же AGENT_BOOTSTRAP_TOKEN, что у API), настройки — agent/agent.yaml.
//
//   yarn agent [команда агента …]    без команды — agent run; например, yarn agent config check,
//                                    yarn agent worker new report, yarn agent upgrade --check
//   yarn agent:start | agent:stop [--force] | agent:status | agent:logs   агент в фоне
//   yarn agent:fetch [версия]        скачать программу агента и сборки агента той же (или этой)
//                                    версии в agent/dist/v<версия> (сквозные тесты: обновление агента
//                                    берёт и прежнюю; AGENT_PLATFORMS="linux-amd64 …")
//   yarn agent:pack                  архивы для узлов и каталог сборок воркеров → agent/bundle
//
// Другой env-файл — ENV_FILE=…, второй агент — AGENT_DIR=.agent-2 AGENT_NAME=dev-2 (свои ключ,
// данные, журнал), привязать к ноде — AGENT_NODE_ID=<id> (метка nodeId). Данные агента —
// <AGENT_DIR>/data; удалить их — агент зарегистрируется заново.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = join(ROOT, "agent/agent");
const REPO = "epifanovmd/agent";
const RUN_DIR = resolve(ROOT, process.env.AGENT_DIR ?? ".agent");
const PID_FILE = join(RUN_DIR, "agent.pid");
const LOG_FILE = join(RUN_DIR, "agent.log");

const fail = message => {
  process.stderr.write(`agent: ${message}\n`);
  process.exit(1);
};

/** Версия агента — как у agent-sdk в package.json (…/agent-sdk-<версия>.tgz). */
const pinnedVersion = () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const found = /agent-sdk-([^/]+)\.tgz$/.exec(pkg.dependencies?.["agent-sdk"] ?? "");

  if (!found) fail("не понять версию agent-sdk в package.json");

  return found[1];
};

const platform = () => {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";

  return { os, arch };
};

const download = async url => {
  const res = await fetch(url);

  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);

  return Buffer.from(await res.arrayBuffer());
};

/** Программа агента: есть — как есть (новые версии ставит agent upgrade); нет — с GitHub. */
const ensureAgent = async () => {
  if (existsSync(AGENT)) return;
  const version = pinnedVersion();
  const { os, arch } = platform();
  const base = process.env.AGENT_RELEASES_URL ?? `https://github.com/${REPO}/releases/download/v${version}`;
  const manifest = JSON.parse((await download(`${base}/manifest.json`)).toString("utf8"));
  const build = manifest.artifacts?.find(a => a.os === os && a.arch === arch);

  if (!build) fail(`в релизе агента ${version} нет сборки под ${os}/${arch}`);
  process.stderr.write(`Программа агента ${version} (${os}/${arch}) — с GitHub в agent/agent\n`);
  const body = await download(`${base}/${encodeURIComponent(build.file)}`);

  if (createHash("sha256").update(body).digest("hex") !== build.sha256.toLowerCase()) {
    fail(`${build.file}: sha256 не совпадает с manifest.json`);
  }
  writeFileSync(`${AGENT}.new`, body, { mode: 0o755 });
  renameSync(`${AGENT}.new`, AGENT);
};

/** Значение из env-файла API (.env.development). */
const envValue = name => {
  const file = resolve(ROOT, process.env.ENV_FILE ?? ".env.development");

  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .reverse()
    .find(l => l.startsWith(`${name}=`));

  return line?.slice(name.length + 1).trim();
};

/** Окружение агента: адрес и токен API, имя и каталог данных этой машины. */
const agentEnv = () => {
  const token = process.env.AGENT_BOOTSTRAP_TOKEN ?? envValue("AGENT_BOOTSTRAP_TOKEN");

  if (!token) fail("нет AGENT_BOOTSTRAP_TOKEN в .env.development (не короче 32 символов; тот же — у API)");
  mkdirSync(join(RUN_DIR, "data"), { recursive: true });

  return {
    ...process.env,
    AGENT_BOOTSTRAP_TOKEN: token,
    SERVER_PORT: process.env.SERVER_PORT ?? envValue("SERVER_PORT") ?? "8181",
    AGENT_NAME: process.env.AGENT_NAME ?? `dev-${process.env.USER ?? "dev"}`,
    AGENT_DATA_DIR: join(RUN_DIR, "data"),
    ...(process.env.AGENT_NODE_ID && {
      AGENT_LABELS: [process.env.AGENT_LABELS, `nodeId=${process.env.AGENT_NODE_ID}`].filter(Boolean).join(","),
    }),
  };
};

const runningPid = () => {
  if (!existsSync(PID_FILE)) return undefined;
  const pid = Number(readFileSync(PID_FILE, "utf8"));

  try {
    process.kill(pid, 0);

    return pid;
  } catch {
    return undefined;
  }
};

/** Воркеры переживают остановку агента (lifecycle.onAgentStop: keep) — их тоже останавливаем. */
const stopWorkers = env => spawnSync(AGENT, ["stop-workers"], { stdio: "inherit", env });

/**
 * Сборки агента той же версии в agent/dist/v<версия>: программа агента под платформы, netprobe,
 * manifest.json — для сквозных тестов (локальный сервер сборок без GitHub). Скачанные файлы с
 * верной суммой не скачиваются заново.
 */
const fetchDist = async (version = pinnedVersion()) => {
  const base = process.env.AGENT_RELEASES_URL ?? `https://github.com/${REPO}/releases/download/v${version}`;
  const out = join(ROOT, "agent/dist", `v${version}`);
  const only = process.env.AGENT_PLATFORMS?.split(/\s+/).filter(Boolean);
  const raw = await download(`${base}/manifest.json`);
  const manifest = JSON.parse(raw.toString("utf8"));
  const sha256 = buf => createHash("sha256").update(buf).digest("hex");

  if (manifest.version !== version) fail(`в ${base} версия ${manifest.version}, ожидалась ${version}`);
  mkdirSync(out, { recursive: true });
  for (const b of [...manifest.artifacts, ...(manifest.workers ?? [])]) {
    if (only && !only.includes(`${b.os}-${b.arch}`)) continue;
    const file = join(out, b.file);

    if (existsSync(file) && sha256(readFileSync(file)) === b.sha256.toLowerCase()) continue;
    const body = await download(`${base}/${encodeURIComponent(b.file)}`);

    if (sha256(body) !== b.sha256.toLowerCase()) fail(`${b.file}: sha256 не совпадает с manifest.json`);
    writeFileSync(`${file}.new`, body, { mode: 0o755 });
    renameSync(`${file}.new`, file);
    process.stderr.write(`${b.file}\n`);
  }
  writeFileSync(join(out, "manifest.json"), raw);
  process.stdout.write(`${out}\n`);
};

const commands = {
  fetch: async ([version]) => {
    await fetchDist(version?.replace(/^v/, ""));
    if (!version) await ensureAgent();
  },

  pack: async args => {
    await ensureAgent();
    const out = join(ROOT, "agent/bundle");

    rmSync(out, { recursive: true, force: true });
    const r = spawnSync(AGENT, ["pack", "--env", "prod", "--out", out, "--release-out", join(out, "release"), ...args], {
      stdio: "inherit",
    });

    process.exit(r.status ?? 1);
  },

  start: async () => {
    const pid = runningPid();

    if (pid) return process.stdout.write(`Уже запущен (pid ${pid})\n`);
    await ensureAgent();
    const env = agentEnv();
    const log = openSync(LOG_FILE, "a");
    const child = spawn(AGENT, ["run"], { env, detached: true, stdio: ["ignore", log, log] });

    closeSync(log);
    writeFileSync(PID_FILE, String(child.pid));
    child.unref();
    process.stdout.write(`Запущен (pid ${child.pid}), журнал — yarn agent:logs\n`);
  },

  stop: async args => {
    const pid = runningPid();

    if (pid) {
      process.kill(pid, args.includes("--force") ? "SIGKILL" : "SIGTERM");
      for (let i = 0; i < 60 && runningPid(); i++) await new Promise(r => setTimeout(r, 1000));
      if (runningPid()) fail(`агент ещё останавливается (pid ${pid}); сразу — yarn agent:stop --force`);
    }
    rmSync(PID_FILE, { force: true });
    if (existsSync(AGENT)) stopWorkers(agentEnv());
    process.stdout.write("Остановлен\n");
  },

  logs: async () => {
    mkdirSync(RUN_DIR, { recursive: true });
    if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, "");
    spawn("tail", ["-n", "200", "-f", LOG_FILE], { stdio: "inherit" });
  },
};

const main = async () => {
  const [cmd = "run", ...args] = process.argv.slice(2);

  if (commands[cmd]) return commands[cmd](args);
  await ensureAgent();
  const env = agentEnv();
  const child = spawn(AGENT, [cmd, ...args], { stdio: "inherit", env });

  if (cmd !== "run") return child.on("exit", code => process.exit(code ?? 1));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill("SIGTERM"));
  child.on("exit", code => {
    stopWorkers(env);
    process.exit(code ?? 0);
  });
};

main().catch(err => fail(err.message));
