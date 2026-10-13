import { ChildProcess, execFile, spawn } from "child_process";
import { once } from "events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

import {
  AGENT_DIST_DIR,
  agentBundleDir,
  BASE_URL,
  PROJECT_KEYS,
} from "./harness";

/**
 * Настоящий агент (github.com/epifanovmd/agent) для сценариев: программа — из
 * сборок агента (`AGENT_DIST_DIR`, `yarn agent:fetch`), воркеры wg и socks —
 * сборки из архива стенда (`agent pack`: `release/`), как на узле после
 * установки; wg — в имитации (`WG_DRY_RUN=1`, каталоги — во временном каталоге
 * агента). Агент проверяет подпись воркеров ключом проекта стенда. Остановка —
 * агент и его воркеры (они переживают агента — `agent stop-workers`).
 */
const env = process.env;

const run = promisify(execFile);

export const platform = (): string =>
  `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "amd64"}`;

const agentBinary = (): string => {
  const file = env.E2E_AGENT_BIN ?? join(AGENT_DIST_DIR, `agent-${platform()}`);

  if (!existsSync(file)) {
    throw new Error(
      `E2E: нет программы агента ${file} — yarn agent:fetch (или E2E_AGENT_BIN)`,
    );
  }

  return file;
};

/** Регистрация напрямую (без агента): проверка токенов. */
export const enroll = async (
  token: string,
  name: string,
): Promise<{ status: number; agentId?: string }> => {
  const res = await fetch(`${BASE_URL}/agent/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      name,
      host: { os: "linux", arch: "amd64", hostname: "e2e" },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;

  return { status: res.status, agentId: data.agentId };
};

/**
 * Сборка воркера из `release/` архива стенда в `<dataDir>/workers/<имя>/current`
 * (как ставит `agent install`).
 */
const installWorker = async (dataDir: string, name: string): Promise<void> => {
  const release = join(agentBundleDir(), "release");
  const archive = readdirSync(release).find(
    file =>
      file.startsWith(`${name}-`) && file.endsWith(`-${platform()}.tar.gz`),
  );

  if (!archive) {
    throw new Error(`E2E: нет сборки ${name} под ${platform()} в ${release}`);
  }

  const version = archive.slice(
    name.length + 1,
    -`-${platform()}.tar.gz`.length,
  );
  const current = join(dataDir, "workers", name, "current");

  mkdirSync(current, { recursive: true });
  await run("tar", ["-xzf", join(release, archive), "-C", current]);
  writeFileSync(join(dataDir, "workers", name, "version"), `${version}\n`);
};

export interface IStartAgentOptions {
  token: string;
  name: string;
  /** Метки агента (привязка к ноде без метки токена — `nodeId`). */
  labels?: Record<string, string>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class RealAgent {
  private readonly _logs: string[] = [];

  private constructor(
    readonly dataDir: string,
    private readonly _config: string,
    private readonly _process: ChildProcess,
  ) {
    _process.stdout?.on("data", chunk => this._logs.push(String(chunk)));
    _process.stderr?.on("data", chunk => this._logs.push(String(chunk)));
  }

  /** Запустить агента с воркерами wg и socks; дождаться регистрации (ключ на диске). */
  static async start(options: IStartAgentOptions): Promise<RealAgent> {
    const dir = mkdtempSync(join(tmpdir(), "e2e-agent-"));
    const dataDir = join(dir, "data");

    await installWorker(dataDir, "wg");
    await installWorker(dataDir, "socks");

    const config = join(dir, "agent.yaml");
    const labels = Object.entries(options.labels ?? {}).map(
      ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
    );

    writeFileSync(
      config,
      [
        "server:",
        `  url: ${BASE_URL}`,
        "  allowInsecure: true",
        `dataDir: ${JSON.stringify(dataDir)}`,
        `name: ${JSON.stringify(options.name)}`,
        ...(labels.length ? ["labels:", ...labels] : []),
        "enroll:",
        `  token: ${JSON.stringify(options.token)}`,
        "update:",
        "  mode: external",
        `  publicKeys: [${JSON.stringify(PROJECT_KEYS.public)}]`,
        "  checkInterval: 0s",
        "log:",
        "  forward: info",
        "workers:",
        "  - name: wg",
        "    release: true",
        "    env:",
        '      WG_DRY_RUN: "1"',
        `      WG_CONFIG_DIR: ${JSON.stringify(join(dir, "wireguard"))}`,
        `      WG_STATE_DIR: ${JSON.stringify(join(dir, "wg-state"))}`,
        "    lifecycle: { stopTimeout: 5s }",
        "  - name: socks",
        "    release: true",
        "    lifecycle: { stopTimeout: 5s }",
        "",
      ].join("\n"),
    );

    const child = spawn(agentBinary(), ["run", "-config", config], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: env.PATH ?? "", HOME: dir },
    });
    const agent = new RealAgent(dataDir, config, child);

    await agent.waitForKey();

    return agent;
  }

  /** Каталог конфигов wg-quick имитации (`WG_CONFIG_DIR`). */
  get wireguardDir(): string {
    return join(this.dataDir, "..", "wireguard");
  }

  /** Id агента из `credentials.json`. */
  get agentId(): string {
    return (
      JSON.parse(
        readFileSync(join(this.dataDir, "credentials.json"), "utf8"),
      ) as { agentId: string }
    ).agentId;
  }

  get log(): string {
    return this._logs.join("");
  }

  /** `agent status --json`: состояние агента и воркеров (агент работает). */
  async status(): Promise<{
    status: string;
    workers?: { name: string; state: string }[];
  } | null> {
    const { stdout } = await run(
      agentBinary(),
      ["status", "-config", this._config, "--json"],
      { env: { PATH: env.PATH ?? "", HOME: join(this.dataDir, "..") } },
    ).catch(() => ({ stdout: "{}" }));

    return (JSON.parse(stdout) as { status?: never }).status ?? null;
  }

  /** Остановить агента и его воркеры (`agent stop-workers`). */
  async stop(): Promise<void> {
    if (this._process.exitCode === null) {
      const exited = once(this._process, "exit");

      this._process.kill("SIGTERM");

      const timer = setTimeout(() => this._process.kill("SIGKILL"), 15_000);

      await exited;
      clearTimeout(timer);
    }
    await run(agentBinary(), ["stop-workers", "-config", this._config], {
      env: { PATH: env.PATH ?? "", HOME: join(this.dataDir, "..") },
    }).catch(() => undefined);
  }

  private async waitForKey(): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (this._process.exitCode !== null) break;
      if (existsSync(join(this.dataDir, "credentials.json"))) return;
      await sleep(100);
    }

    throw new Error(
      `E2E: агент не зарегистрировался\n${this.log.slice(-3000)}`,
    );
  }
}
