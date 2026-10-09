import { ChildProcess, execFileSync, spawn } from "child_process";
import { once } from "events";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  AGENT_VERSION,
  agentBinary,
  PLATFORM,
  PROJECT_RELEASES_DIR,
} from "./agent-release";
import { BASE_URL } from "./harness";

/**
 * Настоящий агент (github.com/epifanovmd/agent, сборки с GitHub из
 * `agent/dist`, см. `agent-release.ts`) с воркерами проекта wg (в режиме
 * `WG_DRY_RUN` — система не меняется) и socks из каталога воркеров стенда.
 * Агент работает в своём временном каталоге со своей копией программы (её
 * заменяет самообновление); как служба — процесс, завершившийся сам
 * (перезапуск после обновления), запускается снова.
 */
const env = process.env;

export interface IRealAgentOptions {
  token: string;
  name: string;
  /** Версия программы агента (по умолчанию — версия agent-sdk). */
  version?: string;
  /** Версия воркеров wg и socks на узле (по умолчанию — как в каталоге сборок). */
  workerVersion?: string;
  /** Обновления агента и воркеров (`update.mode: self`); без — `disabled`. */
  update?: boolean;
  /** Ещё ключи проверки сборок (`update.publicKeys`; агент 1.1 и новее). */
  updateKeys?: string[];
}

interface IManifestWorker {
  name: string;
  version: string;
  os: string;
  arch: string;
  file: string;
}

const projectWorker = (name: string): IManifestWorker => {
  const [os, arch] = PLATFORM.split("-");
  const manifest = JSON.parse(
    readFileSync(join(PROJECT_RELEASES_DIR, "manifest.json"), "utf8"),
  ) as { workers?: IManifestWorker[] };
  const build = manifest.workers?.find(
    w => w.name === name && w.os === os && w.arch === arch,
  );

  if (!build) {
    throw new Error(
      `E2E: нет воркера ${name} для ${PLATFORM} — yarn agent:release`,
    );
  }

  return build;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class RealAgent {
  private readonly _logs: string[] = [];
  private _process: ChildProcess | null = null;
  private _stopping = false;

  private constructor(
    readonly dir: string,
    readonly dataDir: string,
    readonly binary: string,
    private readonly _config: string,
  ) {}

  /** Запустить агента с воркерами wg и socks; дождаться регистрации. */
  static async start(options: IRealAgentOptions): Promise<RealAgent> {
    const version = options.version ?? AGENT_VERSION;
    const source = agentBinary(version);

    if (!source) {
      throw new Error(
        `E2E: нет агента ${version} для ${PLATFORM} — agent/fetch-agent.sh ${version}`,
      );
    }

    const dir = mkdtempSync(join(tmpdir(), "e2e-wg-agent-"));
    const dataDir = join(dir, "data");
    const binary = join(dir, "agent");

    copyFileSync(source, binary);
    chmodSync(binary, 0o755);
    for (const name of ["wg", "socks"]) {
      const build = projectWorker(name);
      const target = join(dataDir, "workers", name);

      mkdirSync(target, { recursive: true });
      copyFileSync(
        join(PROJECT_RELEASES_DIR, build.file),
        join(target, "current"),
      );
      chmodSync(join(target, "current"), 0o755);
      writeFileSync(
        join(target, "version"),
        `${options.workerVersion ?? build.version}\n`,
      );
    }

    const config = join(dir, "agent.yaml");
    const lifecycle =
      "    lifecycle: { onAgentStop: stop, onAgentRestart: restart, stopTimeout: 5s, health: { interval: 1s, timeout: 1s, failures: 5 } }";
    const keys = options.updateKeys?.length
      ? [`  publicKeys: ${JSON.stringify(options.updateKeys)}`]
      : [];

    writeFileSync(
      config,
      [
        "server:",
        `  url: ${BASE_URL}`,
        "  reconnect: { min: 200ms, max: 2s }",
        `dataDir: ${JSON.stringify(dataDir)}`,
        `name: ${JSON.stringify(options.name)}`,
        "enroll:",
        `  token: ${JSON.stringify(options.token)}`,
        "update:",
        `  mode: ${options.update ? "self" : "disabled"}`,
        ...keys,
        "log:",
        "  forward: info",
        "workers:",
        "  - name: wg",
        "    release: true",
        "    env:",
        '      WG_DRY_RUN: "1"',
        `      WG_CONFIG_DIR: ${JSON.stringify(join(dir, "wireguard"))}`,
        `      WG_STATE_DIR: ${JSON.stringify(join(dir, "wg-state"))}`,
        lifecycle,
        "  - name: socks",
        "    release: true",
        lifecycle,
        "",
      ].join("\n"),
    );

    const agent = new RealAgent(dir, dataDir, binary, config);

    agent.run();
    await agent.waitForKey();

    return agent;
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

  /** Версия программы агента в его каталоге (после самообновления — новая). */
  version(): string {
    return execFileSync(this.binary, ["version"], { encoding: "utf8" }).trim();
  }

  /** Остановить агента (воркеры — вместе с ним) и убрать каталог. */
  async stop(): Promise<void> {
    const proc = this._process;

    this._stopping = true;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, "exit");

      proc.kill("SIGTERM");

      const timer = setTimeout(() => proc.kill("SIGKILL"), 15_000);

      await exited;
      clearTimeout(timer);
    }
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Процесс агента; завершился сам — запуск снова (как служба). */
  private run(): void {
    const proc = spawn(this.binary, ["run", "-config", this._config], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: env.PATH ?? "", HOME: this.dir, TMPDIR: this.dir },
    });

    this._process = proc;
    proc.stdout?.on("data", chunk => this._logs.push(String(chunk)));
    proc.stderr?.on("data", chunk => this._logs.push(String(chunk)));
    proc.on("exit", (code, signal) => {
      this._logs.push(`--- агент завершился: code=${code} signal=${signal}\n`);
      if (this._stopping || this._process !== proc) return;
      setTimeout(() => {
        if (!this._stopping) this.run();
      }, 200);
    });
  }

  private async waitForKey(): Promise<void> {
    for (let i = 0; i < 150; i += 1) {
      if (existsSync(join(this.dataDir, "credentials.json"))) return;
      await sleep(100);
    }

    throw new Error(
      `E2E: агент не зарегистрировался\n${this.log.slice(-3000)}`,
    );
  }
}
