import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { inject } from "inversify";
import { join } from "path";
import { isDeepStrictEqual } from "util";

import { openSecret, parseSecretBoxKey, sealSecret } from "../crypto";
import { Injectable } from "../decorators";
import { EventBus } from "../event-bus";
import { agentConfig, agentReleasesDir } from "./agent.config";
import { Agent } from "./agent.entity";
import { AgentError } from "./agent.errors";
import {
  AgentCommandQueuedEvent,
  AgentConfigChangedEvent,
  AgentDeletedEvent,
  AgentUpdatedEvent,
} from "./agent.events";
import { AgentRepository } from "./agent.repository";
import { AgentSignals } from "./agent.signals";
import { AgentCommand } from "./agent-command.entity";
import { AgentCommandRepository } from "./agent-command.repository";
import { AgentConfigRepository } from "./agent-config.repository";
import { AgentEvent } from "./agent-event.entity";
import {
  AgentEventRepository,
  IAgentEventFilter,
} from "./agent-event.repository";
import { AgentMetric } from "./agent-metric.entity";
import { AgentMetricRepository } from "./agent-metric.repository";
import { schemaProblems } from "./agent-schemas";
import {
  AGENT_PROTOCOL_PREFIX,
  AgentCommandType,
  compareAgentVersions,
  IAgentAppliedStatus,
  IAgentDesired,
  IAgentHealth,
  IAgentReleaseManifest,
  IAgentWatch,
  IAgentWorkerManifest,
  TAgentWorkerState,
} from "./protocol";

/** Агент на связи: поток открыт и обновлялся недавно, или был запрос (длинный опрос). */
const STREAM_STALE_MS = 60_000;
const POLL_STALE_MS = 75_000;

/** Как долго ждать итог, если не сказано, мс. */
const DEFAULT_WAIT_MS = 30_000;

/** Воркер агента: что он объявил в hello и что агент сообщает о нём в состоянии. */
export interface IAgentWorkerView {
  name: string;
  version?: string;
  release: boolean;
  state: TAgentWorkerState | "unknown";
  message?: string;
  restarts: number;
  health?: IAgentHealth;
  pending?: "restart" | "update";
  manifest?: IAgentWorkerManifest;
}

/** Ключ настроек воркера и итог его применения. */
export interface IAgentConfigStatus {
  worker: string;
  key: string;
  version: number;
  /** `pending` — воркер ещё не применил эту версию; `applied` / `failed` — итог воркера. */
  state: "pending" | "applied" | "failed";
  error?: { code: string; message: string };
  updatedAt: Date;
  actor: string | null;
}

export interface ISendCommandOptions {
  /** Свой id (повтор с тем же id не ставит команду второй раз). */
  id?: string;
  /** Срок: агент не начнёт команду позже, мс от сейчас. */
  deadlineMs?: number;
  actor?: string | null;
}

export interface IWorkerCommandOptions extends ISendCommandOptions {
  /** Срок ответа воркера, мс (нет — без срока: долгая команда). */
  timeoutMs?: number;
  /** Внешняя задача (`{ jobId, data, files }`): по схеме команды проверяется `data`. */
  job?: boolean;
}

type TSealed = { $sealed: string };

const isSealed = (value: unknown): value is TSealed =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TSealed).$sealed === "string";

/** Манифест воркера из последнего `hello` агента. */
export const workerManifest = (
  agent: Agent,
  worker: string,
): IAgentWorkerManifest | undefined =>
  agent.hello?.workers.find(w => w.name === worker)?.manifest;

/** Новый id: 32 hex. */
export const newAgentId = (): string => randomBytes(16).toString("hex");

/**
 * Агенты для доменных модулей: список и воркеры, желаемое (настройки воркеров, наблюдение),
 * команды и их итоги, история событий и метрик. Всё хранится в БД: писать и ставить команды
 * может любая копия API, агенту их доставляет копия с его потоком (сигнал `agent_push`).
 */
@Injectable()
export class Agents {
  private readonly _key = agentConfig.configsKey
    ? parseSecretBoxKey(agentConfig.configsKey)
    : null;

  constructor(
    @inject(AgentRepository) private readonly _agents: AgentRepository,
    @inject(AgentConfigRepository)
    private readonly _configs: AgentConfigRepository,
    @inject(AgentCommandRepository)
    private readonly _commands: AgentCommandRepository,
    @inject(AgentEventRepository)
    private readonly _events: AgentEventRepository,
    @inject(AgentMetricRepository)
    private readonly _metrics: AgentMetricRepository,
    @inject(AgentSignals) private readonly _signals: AgentSignals,
    @inject(EventBus) private readonly _bus: EventBus,
  ) {}

  // ─── агенты ──────────────────────────────────────────────────────────

  find(id: string): Promise<Agent | null> {
    return this._agents.findLive(id);
  }

  async get(id: string): Promise<Agent> {
    const agent = await this._agents.findLive(id);

    if (!agent) throw AgentError.NOT_FOUND();

    return agent;
  }

  all(): Promise<Agent[]> {
    return this._agents.findAll();
  }

  page(offset: number, limit: number): Promise<[Agent[], number]> {
    return this._agents.findPage(offset, limit);
  }

  /** На связи: поток открыт (и жив) или недавно был запрос. */
  isOnline(agent: Agent, now = Date.now()): boolean {
    if (agent.revokedAt || agent.deletedAt) return false;
    const seen = agent.lastSeenAt?.getTime() ?? 0;

    return agent.streamInstance
      ? now - seen < STREAM_STALE_MS
      : now - seen < POLL_STALE_MS;
  }

  /** Воркеры агента: из hello (версия, манифест) и состояния (жизнь, пульс). */
  workers(agent: Agent): IAgentWorkerView[] {
    const states = new Map((agent.state?.workers ?? []).map(w => [w.name, w]));
    const hello = agent.hello?.workers ?? [];
    const names = [...new Set([...hello.map(w => w.name), ...states.keys()])];

    return names.map(name => {
      const h = hello.find(w => w.name === name);
      const s = states.get(name);

      return {
        name,
        version: s?.version ?? h?.version,
        release: Boolean(s?.release ?? h?.release),
        state: s?.state ?? "unknown",
        message: s?.message,
        restarts: s?.restarts ?? 0,
        health: s?.health,
        pending: s?.pending,
        manifest: h?.manifest,
      };
    });
  }

  /** Манифест воркера из последнего hello. */
  manifest(agent: Agent, worker: string): IAgentWorkerManifest | undefined {
    return workerManifest(agent, worker);
  }

  /** Отозвать: агент больше не войдёт (403), его поток закрывается; воркеры на узле работают. */
  async revoke(agentId: string): Promise<Agent> {
    const agent = await this.get(agentId);

    if (!agent.revokedAt) {
      agent.revokedAt = new Date();
      await this._agents.save(agent);
      await this.push(agentId);
      this._bus.emit(new AgentUpdatedEvent(agent, "revoked"));
    }

    return agent;
  }

  /**
   * Удалить агента: настройки, команды и история удаляются, запись остаётся отозванной
   * (`deletedAt`): агент на узле получает `403 AGENT_REVOKED` — останавливает воркеры с уборкой и
   * больше не выходит на связь (не регистрируется заново и общим токеном).
   */
  async delete(agentId: string): Promise<void> {
    await this.get(agentId);
    await this._agents.manager.transaction(async manager => {
      for (const table of [
        "agent_configs",
        "agent_commands",
        "agent_events",
        "agent_metrics",
      ]) {
        await manager.query(`DELETE FROM ${table} WHERE agent_id = $1`, [
          agentId,
        ]);
      }
      await manager.query(
        `UPDATE agents SET revoked_at = coalesce(revoked_at, now()), deleted_at = now(),
           hello = NULL, state = NULL, metrics = NULL, watch = NULL
         WHERE id = $1`,
        [agentId],
      );
    });
    await this.push(agentId);
    this._bus.emit(new AgentDeletedEvent(agentId));
  }

  // ─── желаемое ────────────────────────────────────────────────────────

  /** Желаемое агента целиком: настройки воркеров и наблюдение. */
  async desired(agent: Agent): Promise<IAgentDesired> {
    const configs = await this._configs.findByAgent(agent.id);
    const workers: IAgentDesired["workers"] = {};

    for (const c of configs) {
      if (c.data === null) continue;
      workers[c.worker] ??= { configs: {} };
      workers[c.worker].configs[c.key] = {
        version: c.version,
        data: this.open(c.data),
      };
    }

    const watch =
      agent.watch && (!agent.watch.until || agent.watch.until > Date.now())
        ? agent.watch
        : null;

    return { rev: agent.desiredRev, workers, watch };
  }

  /** Значение ключа настроек (`undefined` — нет или удалён). */
  async getConfig(
    agentId: string,
    worker: string,
    key: string,
  ): Promise<unknown> {
    const row = await this._configs.findOne3(agentId, worker, key);

    return row && row.data !== null ? this.open(row.data) : undefined;
  }

  /**
   * Записать ключ настроек воркера (новая версия, агент получит новое желаемое). С
   * `onlyIfChanged` то же значение не пишется. Вернуть версию.
   */
  async setConfig(
    agentId: string,
    worker: string,
    key: string,
    data: unknown,
    options: { actor?: string | null; onlyIfChanged?: boolean } = {},
  ): Promise<number> {
    const agent = await this.get(agentId);
    const manifest = this.manifest(agent, worker);

    if (manifest && !manifest.configs?.some(c => c.key === key)) {
      throw AgentError.CONFIG_UNDECLARED(
        undefined,
        `Воркер ${worker} не объявил ключ настроек ${key}`,
      );
    }
    const problems = schemaProblems(
      manifest?.configs?.find(c => c.key === key)?.schema,
      data,
    );

    if (problems.length)
      throw AgentError.CONFIG_INVALID({ reason: problems.join("; ") });
    if (options.onlyIfChanged) {
      const row = await this._configs.findOne3(agentId, worker, key);

      if (
        row &&
        row.data !== null &&
        isDeepStrictEqual(this.open(row.data), data)
      ) {
        return row.version;
      }
    }

    return this.writeConfig(agent, worker, key, data, options.actor ?? null);
  }

  /** Удалить ключ настроек: воркер получит желаемое без него. */
  async deleteConfig(
    agentId: string,
    worker: string,
    key: string,
    actor: string | null = null,
  ): Promise<void> {
    const agent = await this.get(agentId);
    const row = await this._configs.findOne3(agentId, worker, key);

    if (!row || row.data === null) return;
    await this.writeConfig(agent, worker, key, null, actor);
  }

  /** Ключи настроек агента и итоги их применения воркерами (из состояния агента). */
  async configStatus(agent: Agent): Promise<IAgentConfigStatus[]> {
    const configs = await this._configs.findByAgent(agent.id);
    const applied = new Map<string, IAgentAppliedStatus>();

    for (const w of agent.state?.workers ?? []) {
      for (const [key, status] of Object.entries(w.configs ?? {})) {
        applied.set(`${w.name}/${key}`, status);
      }
    }

    return configs
      .filter(c => c.data !== null)
      .map(c => {
        const status = applied.get(`${c.worker}/${c.key}`);
        const done =
          status && status.version === c.version && status.ok !== undefined;

        return {
          worker: c.worker,
          key: c.key,
          version: c.version,
          state: !done ? "pending" : status.ok ? "applied" : "failed",
          error: done && !status.ok ? status.error : undefined,
          updatedAt: c.updatedAt,
          actor: c.actor,
        };
      });
  }

  /** Наблюдение (метрики чаще, журнал подробнее) до `until`; `null` — снять. */
  async setWatch(agentId: string, watch: IAgentWatch | null): Promise<void> {
    const agent = await this.get(agentId);

    if (isDeepStrictEqual(agent.watch, watch)) return;
    agent.watch = watch;
    await this._agents.update({ id: agentId }, { watch: watch as never });
    await this._agents.bumpDesired(agentId);
    await this.push(agentId);
    this._bus.emit(new AgentUpdatedEvent(agent, "watch"));
  }

  // ─── команды ─────────────────────────────────────────────────────────

  /** Поставить команду агенту; повтор с тем же `id` возвращает прежнюю. */
  async send(
    agentId: string,
    type: string,
    args: unknown,
    options: ISendCommandOptions & {
      worker?: string;
      workerType?: string;
    } = {},
  ): Promise<AgentCommand> {
    const agent = await this.get(agentId);

    if (agent.revokedAt) throw AgentError.REVOKED();
    const id = options.id ?? newAgentId();
    const existing = await this._commands.findById(id);

    if (existing) return existing;

    const command = await this._commands.save(
      this._commands.create({
        id,
        agentId,
        type,
        args: args === undefined ? null : (args as object),
        worker: options.worker ?? null,
        workerType: options.workerType ?? null,
        deadlineAt: options.deadlineMs
          ? new Date(Date.now() + options.deadlineMs)
          : null,
        status: "pending",
        ok: null,
        result: null,
        error: null,
        progress: null,
        progressText: null,
        actor: options.actor ?? null,
        finishedAt: null,
      }),
    );

    await this.push(agentId);
    this._bus.emit(new AgentCommandQueuedEvent(command));

    return command;
  }

  /** Команда воркеру (`worker.command`): id команды воркер получит как есть. */
  async workerCommand(
    agentId: string,
    worker: string,
    type: string,
    args: unknown,
    options: IWorkerCommandOptions = {},
  ): Promise<AgentCommand> {
    const agent = await this.get(agentId);
    const manifest = this.manifest(agent, worker);

    if (!this.workers(agent).some(w => w.name === worker)) {
      throw AgentError.WORKER_NOT_FOUND(
        undefined,
        `Воркера ${worker} нет на агенте`,
      );
    }
    const declared = manifest?.commands?.find(c => c.type === type);

    if (manifest && !declared) {
      throw AgentError.COMMAND_UNDECLARED(
        undefined,
        `Воркер ${worker} не объявил команду ${type}`,
      );
    }
    // Схема команды описывает её аргументы, у внешней задачи — её data.
    const input = options.job
      ? (args as { data?: unknown } | null)?.data
      : args;
    const problems = schemaProblems(declared?.schema, input);

    if (problems.length)
      throw AgentError.COMMAND_INVALID({ reason: problems.join("; ") });

    return this.send(
      agentId,
      AgentCommandType.WORKER_COMMAND,
      { worker, type, args, timeoutMs: options.timeoutMs },
      { ...options, worker, workerType: type },
    );
  }

  /** Отменить идущую команду воркера. */
  cancelWorkerCommand(
    agentId: string,
    worker: string,
    re: string,
  ): Promise<AgentCommand> {
    return this.send(
      agentId,
      AgentCommandType.WORKER_CANCEL,
      { worker, re },
      { worker },
    );
  }

  findCommand(id: string): Promise<AgentCommand | null> {
    return this._commands.findById(id);
  }

  recentCommands(agentId: string, limit = 50): Promise<AgentCommand[]> {
    return this._commands.findRecent(agentId, limit);
  }

  /** Дождаться итога команды; `null` — не дождались за `timeoutMs`. */
  async wait(
    id: string,
    timeoutMs = DEFAULT_WAIT_MS,
  ): Promise<AgentCommand | null> {
    const deadline = Date.now() + timeoutMs;
    let wake: () => void = () => undefined;
    const off = this._signals.on("agent_result", payload => {
      if (payload === id) wake();
    });

    try {
      for (;;) {
        const command = await this._commands.findById(id);

        if (!command || command.status === "done") return command;
        const left = deadline - Date.now();

        if (left <= 0) return null;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, Math.min(left, 1_000));

          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    } finally {
      off();
    }
  }

  /** Поставить команду и дождаться итога; не дождались — `AGENT_TIMEOUT`. */
  async call(
    agentId: string,
    type: string,
    args: unknown,
    timeoutMs = DEFAULT_WAIT_MS,
    options: ISendCommandOptions = {},
  ): Promise<AgentCommand> {
    const command = await this.send(agentId, type, args, options);
    const done = await this.wait(command.id, timeoutMs);

    if (!done) throw AgentError.TIMEOUT();

    return done;
  }

  /** `worker.restart`: итог — после регистрации нового процесса (занятый — после работы). */
  restartWorker(
    agentId: string,
    worker: string,
    force = false,
    actor: string | null = null,
  ): Promise<AgentCommand> {
    return this.send(
      agentId,
      AgentCommandType.WORKER_RESTART,
      { worker, force },
      { actor, worker },
    );
  }

  /**
   * `worker.update` на версию из каталога сборок воркеров проекта (`release/`); без версии —
   * старшая для платформы узла.
   */
  async updateWorker(
    agentId: string,
    worker: string,
    options: { version?: string; force?: boolean; actor?: string | null } = {},
  ): Promise<AgentCommand> {
    const agent = await this.get(agentId);
    const view = this.workers(agent).find(w => w.name === worker);

    if (!view) {
      throw AgentError.WORKER_NOT_FOUND(
        undefined,
        `Воркера ${worker} нет на агенте`,
      );
    }
    if (!view.release) throw AgentError.WORKER_NOT_RELEASED();
    const build = this.workerBuild(agent, worker, options.version);

    if (!build)
      throw AgentError.RELEASE_NOT_FOUND(
        undefined,
        `Сборки ${worker} для узла нет в каталоге`,
      );

    return this.send(
      agentId,
      AgentCommandType.WORKER_UPDATE,
      {
        worker,
        version: build.version,
        url: `${AGENT_PROTOCOL_PREFIX}/releases/${build.file}`,
        sha256: build.sha256,
        signature: build.signature ?? "",
        force: options.force,
      },
      { actor: options.actor, worker },
    );
  }

  /** Сборка воркера для платформы агента из каталога сборок (старшая или `version`). */
  workerBuild(agent: Agent, worker: string, version?: string) {
    const manifest = this.releaseManifest();
    const host = agent.hello?.host ?? agent.host;

    if (!manifest || !host) return undefined;

    return (manifest.workers ?? [])
      .filter(
        w => w.name === worker && w.os === host.os && w.arch === host.arch,
      )
      .filter(w => !version || w.version === version)
      .sort((a, b) => compareAgentVersions(b.version, a.version))[0];
  }

  /** Каталог сборок воркеров проекта (`release/manifest.json`); нет — `undefined`. */
  releaseManifest(): IAgentReleaseManifest | undefined {
    const dir = agentReleasesDir();

    if (!dir) return undefined;
    try {
      return JSON.parse(
        readFileSync(join(dir, "manifest.json"), "utf8"),
      ) as IAgentReleaseManifest;
    } catch {
      return undefined;
    }
  }

  /** `agent.update` на версию (по умолчанию — новую, которую агент нашёл в своём каталоге). */
  async updateAgent(
    agentId: string,
    version?: string,
    actor: string | null = null,
  ): Promise<AgentCommand> {
    const agent = await this.get(agentId);
    const target = version ?? agent.state?.update?.latest;

    if (!target) throw AgentError.UPDATE_NOT_AVAILABLE();

    return this.send(
      agentId,
      AgentCommandType.AGENT_UPDATE,
      { version: target },
      { actor },
    );
  }

  /** `agent.rotateKey`: агент создаёт новый секрет, бэкенд узнаёт его хеш из итога. */
  rotateKey(
    agentId: string,
    actor: string | null = null,
  ): Promise<AgentCommand> {
    return this.send(agentId, AgentCommandType.AGENT_ROTATE_KEY, undefined, {
      actor,
    });
  }

  /** `agent.logs`: последние записи журнала агента или воркера (ждёт итог). */
  async logs(
    agentId: string,
    worker?: string,
    lines = 200,
  ): Promise<AgentCommand> {
    const agent = await this.get(agentId);

    if (!this.isOnline(agent)) throw AgentError.OFFLINE();

    return this.call(
      agentId,
      AgentCommandType.AGENT_LOGS,
      { worker, lines },
      15_000,
    );
  }

  // ─── история ─────────────────────────────────────────────────────────

  eventFeed(filter: IAgentEventFilter): Promise<AgentEvent[]> {
    return this._events.findFeed(filter);
  }

  metrics(
    agentId: string,
    since: number,
    until: number,
    limit: number,
  ): Promise<AgentMetric[]> {
    return this._metrics.findRange(agentId, since, until, limit);
  }

  // ─── служебное ───────────────────────────────────────────────────────

  /** Разбудить копию с потоком агента: у него новое желаемое или команда. */
  push(agentId: string): Promise<void> {
    return this._signals.notify("agent_push", agentId);
  }

  private async writeConfig(
    agent: Agent,
    worker: string,
    key: string,
    data: unknown,
    actor: string | null,
  ): Promise<number> {
    const version = await this._configs.put(
      agent.id,
      worker,
      key,
      data === null ? null : this.seal(data),
      actor,
    );

    await this._agents.bumpDesired(agent.id);
    await this.push(agent.id);
    this._bus.emit(
      new AgentConfigChangedEvent(
        agent.id,
        worker,
        key,
        version,
        data === null,
      ),
    );

    return version;
  }

  private seal(data: unknown): unknown {
    return this._key
      ? { $sealed: sealSecret(JSON.stringify(data ?? null), this._key) }
      : data;
  }

  private open(data: unknown): unknown {
    if (!isSealed(data)) return data;
    if (!this._key)
      throw new Error("AGENT_CONFIGS_KEY не задан, а значение зашифровано");

    return JSON.parse(openSecret(data.$sealed, this._key));
  }
}
