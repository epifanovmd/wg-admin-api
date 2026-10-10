import {
  type Agent,
  type AgentEvent,
  type AgentReleasesOptions,
  Agents,
  type InvalidEvent,
  type RelayFunction,
} from "agent-sdk/server";
import { randomBytes } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { inject } from "inversify";
import { hostname, networkInterfaces } from "os";
import { z } from "zod";

import { config } from "../../config";
import { EventBus, Injectable, logger } from "../../core";
import { agentConfig, bundleReleasesDir } from "./agent.config";
import { AgentSignals } from "./agent.signals";
import { AGENT_RELAY_PATH, AGENTS_CHANGED_CHANNEL } from "./agent.types";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AgentHistoryService, toAgentEventDto } from "./agent-history.service";
import {
  AgentAlertDto,
  AgentConfigStatusDto,
  AgentDto,
  toMetricsPointDto,
} from "./dto";
import {
  AgentActionAuditedEvent,
  AgentActionFinishedEvent,
  AgentAlertChangedEvent,
  AgentConfigChangedEvent,
  AgentDeletedEvent,
  AgentEnrolledEvent,
  AgentEventReceivedEvent,
  AgentLogReceivedEvent,
  AgentMetricsReceivedEvent,
  AgentReleaseChangedEvent,
  AgentUpdatedEvent,
} from "./events";
import { AgentStore } from "./store/agent.store";

/** Изменения копятся столько перед NOTIFY и перед refresh. */
const COALESCE_MS = 100;
/** Больше агентов в одном сигнале — «обновить всех» (предел NOTIFY — 8000 байт). */
const MAX_SIGNAL_IDS = 100;
/** Замечания к событиям, ждущим `onEvent`, — не больше (защита от утечки). */
const MAX_PENDING_PROBLEMS = 1_000;

const eventKey = (event: Pick<AgentEvent, "agentId" | "id">): string =>
  `${event.agentId}\n${event.id}`;

/** Сигнал другим процессам: кого перечитать. */
const ChangeSignalSchema = z.object({
  from: z.string(),
  all: z.boolean(),
  ids: z.array(z.string()).max(MAX_SIGNAL_IDS),
});

type TChangeSignal = z.infer<typeof ChangeSignalSchema>;

/** Накопленные изменения: все агенты или перечисленные. */
class PendingChanges {
  all = false;
  readonly ids = new Set<string>();

  add(agentId: string | undefined): void {
    if (agentId) this.ids.add(agentId);
    else this.all = true;
  }

  take(): { all: boolean; ids: string[] } {
    const taken = {
      all: this.all || this.ids.size > MAX_SIGNAL_IDS,
      ids: [...this.ids],
    };

    this.all = false;
    this.ids.clear();

    return taken;
  }
}

const parseJson = <T>(schema: z.ZodType<T>, payload: string): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(payload));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Адреса «на все интерфейсы»: копию по ним не найти. */
const ANY_HOSTS = new Set(["", "0.0.0.0", "::", "[::]"]);

/** IPv4 машины (первый внешний интерфейс); нет — 127.0.0.1. */
const machineIpv4 = (): string =>
  Object.values(networkInterfaces())
    .flat()
    .find(net => net?.family === "IPv4" && !net.internal)?.address ??
  "127.0.0.1";

/** `http://host:port`; адрес «на все интерфейсы» — IPv4 машины. */
const urlOf = (host: string, port: number): string => {
  const reachable = ANY_HOSTS.has(host) ? machineIpv4() : host;

  return `http://${reachable.includes(":") ? `[${reachable}]` : reachable}:${port}`;
};

/**
 * Имя копии в `agent.session.instance`. С пересылкой — внутренний адрес её
 * сервера пересылки (по нему другие копии пересылают вызовы); без неё —
 * адрес API (уникален среди копий). Без HTTP (роль `worker`) соединений
 * агентов нет — узнаваемое уникальное имя.
 */
const newInstanceId = (): string => {
  if (config.app.role === "worker") {
    return `worker:${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  }
  if (agentConfig.instanceUrl)
    return agentConfig.instanceUrl.replace(/\/+$/, "");

  return agentConfig.relaySecret
    ? urlOf(agentConfig.relayHost, agentConfig.relayPort)
    : urlOf(config.server.host, config.server.port);
};

/** Доставка вызова в копию с соединением агента: её сервер пересылки. */
const relayTo: RelayFunction = (instanceId, request) =>
  fetch(new URL(AGENT_RELAY_PATH, instanceId), {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  });

/**
 * Откуда брать агента и netprobe: адрес сборок (`AGENT_RELEASES_URL`) или
 * релизы GitHub (`AGENT_RELEASES_GITHUB`); ни того ни другого — только
 * `releasesDir`.
 */
export const agentReleasesOptions = (
  cfg: Pick<
    typeof agentConfig,
    | "releasesUrl"
    | "releasesGithub"
    | "releasesRange"
    | "releasesToken"
    | "releasesProxy"
    | "releasesCheckIntervalMs"
    | "releasesPublicKey"
  > = agentConfig,
): AgentReleasesOptions | undefined => {
  const common = {
    checkIntervalMs: cfg.releasesCheckIntervalMs,
    proxy: cfg.releasesProxy,
    ...(cfg.releasesPublicKey && { publicKey: cfg.releasesPublicKey }),
  };

  if (cfg.releasesUrl) return { ...common, url: cfg.releasesUrl };
  if (cfg.releasesGithub) {
    return {
      ...common,
      github: cfg.releasesGithub,
      range: cfg.releasesRange,
      ...(cfg.releasesToken && { token: cfg.releasesToken }),
    };
  }

  return undefined;
};

type TWorkerEventHandler = (event: AgentEvent) => Promise<void>;

/**
 * `Agents` из agent-sdk — один на процесс: регистрация, WebSocket агентов,
 * запросы к воркерам, задачи, настройки, наблюдение, действия, раздача сборок агента.
 * Хранилище — Postgres (`AgentStore`). События SDK уходят в EventBus;
 * история (события воркеров, метрики) — в свои таблицы. Изменения в Store,
 * которые должен доставить процесс с соединением агента, — сигналом
 * `agents_changed` (каждый процесс вызывает `refresh`). Вызовы, которым
 * нужна копия с соединением агента (запрос к воркеру, задачи, действия,
 * наблюдение), SDK пересылает туда сам (`relay`), если задан общий секрет
 * копий `AGENT_RELAY_SECRET`; адрес копии — её `instanceId`.
 */
@Injectable()
export class AgentRuntime {
  private _agents: Agents | null = null;
  private readonly _instanceId = newInstanceId();
  private readonly _outgoing = new PendingChanges();
  private readonly _incoming = new PendingChanges();
  private _outgoingTimer: NodeJS.Timeout | null = null;
  private _incomingTimer: NodeJS.Timeout | null = null;
  private _started = false;
  private readonly _eventHandlers = new Set<TWorkerEventHandler>();
  private readonly _reconnectHandlers = new Set<(agentId: string) => void>();
  /** Время подключения агента, о котором уже сообщили, — по сессиям этого процесса. */
  private readonly _connectedAt = new Map<string, number>();
  /** Воркеры агента в работе: «имя → перезапуски», — чтобы заметить их перезапуск. */
  private readonly _running = new Map<string, Map<string, number>>();
  /** Замечания проверки по схеме к событиям, которые ещё придут в `onEvent`. */
  private readonly _problems = new Map<string, string[]>();

  constructor(
    @inject(AgentStore) private readonly _store: AgentStore,
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
    @inject(AgentHistoryService) private readonly _history: AgentHistoryService,
    @inject(AgentSignals) private readonly _signals: AgentSignals,
    @inject(EventBus) private readonly _eventBus: EventBus,
  ) {}

  /** `Agents` процесса; создаётся при первом обращении. */
  get agents(): Agents {
    this._agents ??= this.create();

    return this._agents;
  }

  get instanceId(): string {
    return this._instanceId;
  }

  /** Процесс держит соединения агентов (роли с HTTP). */
  get hasConnections(): boolean {
    return config.app.role !== "worker";
  }

  /** Вызовы пересылаются в копию с соединением агента. */
  get relayEnabled(): boolean {
    return !!agentConfig.relaySecret;
  }

  /** Соединение агента — в этом процессе. */
  isLocal(agent: Pick<Agent, "online" | "session">): boolean {
    return agent.online && agent.session?.instance === this._instanceId;
  }

  /**
   * HTTP-запрос агента (регистрация, сборки агента, `install.sh`): в контексте
   * регистрации, чтобы новый агент получил событие `AgentEnrolledEvent` с
   * источником.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return this._enrollment.withContext(() => this.agents.handle(req, res));
  }

  /**
   * Обработчик событий воркеров: вызывается до сохранения события и до
   * подтверждения агенту; ошибка — агент пришлёт событие снова.
   */
  onWorkerEvent(handler: TWorkerEventHandler): () => void {
    this._eventHandlers.add(handler);

    return () => this._eventHandlers.delete(handler);
  }

  /**
   * Агент (снова) подключился к этому процессу или его воркер запустился
   * заново: работы воркеров пора сверить.
   */
  onReconnect(handler: (agentId: string) => void): () => void {
    this._reconnectHandlers.add(handler);

    return () => this._reconnectHandlers.delete(handler);
  }

  /**
   * Вызов, пересланный другой копией (`relay`, внутренний сервер
   * пересылки): выполнить здесь и ответить. Без общего секрета пересылки
   * нет — `false` (маршрут не обслуживается).
   */
  async handleRelay(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!this.relayEnabled) return false;
    await this.agents.handleRelay(req, res);

    return true;
  }

  /** События SDK → EventBus и история; сигналы между процессами. */
  async start(): Promise<void> {
    if (this._started) return;

    this._started = true;
    this.bridge(this.agents);
    this.share(this.agents);
    this._signals.on(AGENTS_CHANGED_CHANNEL, payload =>
      this.onChanged(payload),
    );
    await this._signals.start();
  }

  /** Соединениям — 1012 (агенты переподключатся к другому процессу). */
  async stop(): Promise<void> {
    if (this._outgoingTimer) clearTimeout(this._outgoingTimer);
    if (this._incomingTimer) clearTimeout(this._incomingTimer);
    this._outgoingTimer = null;
    this._incomingTimer = null;
    await this._agents?.close();
    this._agents?.removeAllListeners();
    this._agents = null;
    this._started = false;
    await this._signals.stop();
  }

  private create(): Agents {
    return new Agents({
      enroll: (token, info) => this._enrollment.enroll(token, info),
      store: this._store,
      instanceId: this._instanceId,
      statusIntervalMs: agentConfig.statusIntervalMs,
      metricsIntervalMs: agentConfig.metricsIntervalMs,
      offlineGraceMs: agentConfig.offlineGraceMs,
      ...(this.relayEnabled && {
        relay: relayTo,
        relaySecret: agentConfig.relaySecret,
      }),
      releasesDir: bundleReleasesDir(),
      agentReleases: agentReleasesOptions(),
      baseUrl: agentConfig.publicUrl,
      trustProxy: config.server.trustProxy,
      validateConfigs: true,
      validateRequests: true,
      validateEvents: agentConfig.validateEvents,
      onEvent: event => this.handleWorkerEvent(event),
      log: (msg, extra) => logger.info({ ...extra }, `[Agent] ${msg}`),
    });
  }

  /**
   * Событие воркера: обработчики модулей (задачи), затем история (с
   * замечаниями проверки по схеме, если были); новое — в EventBus.
   * Подтверждение агенту — после успеха.
   */
  private async handleWorkerEvent(event: AgentEvent): Promise<void> {
    const key = eventKey(event);
    const problems = this._problems.get(key);

    for (const handler of this._eventHandlers) await handler(event);
    this._problems.delete(key);
    await this.saveEvent(event, problems);
  }

  private async saveEvent(
    event: AgentEvent,
    problems: string[] | undefined,
  ): Promise<void> {
    if (await this._history.saveEvent(event, problems)) {
      this._eventBus.emit(
        new AgentEventReceivedEvent(toAgentEventDto(event, problems)),
      );
    }
  }

  /**
   * `data` события не по схеме манифеста (`validateEvents`): журнал;
   * `log` — замечания попадут в историю вместе с событием (`onEvent`
   * следует сразу), `reject` — событие только в историю, обработчикам
   * модулей не передаётся.
   */
  private onInvalidEvent({ event, problems, rejected }: InvalidEvent): void {
    logger.warn(
      {
        agentId: event.agentId,
        worker: event.worker,
        type: event.type,
        problems,
        rejected,
      },
      "[Agent] data события не подходит под схему манифеста воркера",
    );
    if (rejected) {
      this.saveEvent(event, problems).catch(err =>
        logger.warn(
          { err, agentId: event.agentId },
          "[Agent] Отклонённое событие не сохранено",
        ),
      );

      return;
    }
    if (this._problems.size >= MAX_PENDING_PROBLEMS) {
      const oldest = this._problems.keys().next().value;

      if (oldest !== undefined) this._problems.delete(oldest);
    }
    this._problems.set(eventKey(event), problems);
  }

  /** События SDK этого процесса → доменные события модуля. */
  private bridge(agents: Agents): void {
    const emit = this._eventBus.emit.bind(this._eventBus);

    agents.on("agent", agent => {
      const dto = AgentDto.fromModel(agent);
      // Регистрация: SDK сообщает о новом агенте в цепочке запроса enroll.
      const source = this._enrollment.takeSource();

      emit(new AgentUpdatedEvent(dto));
      if (source) emit(new AgentEnrolledEvent(dto, source));
      this.detectReconnect(agent);
    });
    agents.on("invalidEvent", invalid => this.onInvalidEvent(invalid));
    agents.on("release", release => {
      logger.info(
        {
          version: release.version,
          previous: release.previous,
          from: release.from,
        },
        "[Agent] Версия агента в источнике",
      );
      emit(
        new AgentReleaseChangedEvent({
          version: release.version,
          ...(release.previous && { previous: release.previous }),
          from: release.from,
        }),
      );
    });
    agents.on("alert", alert =>
      emit(new AgentAlertChangedEvent(AgentAlertDto.fromModel(alert))),
    );
    agents.on("metrics", point =>
      emit(
        new AgentMetricsReceivedEvent(point.agentId, toMetricsPointDto(point)),
      ),
    );
    agents.on("log", ({ agentId, entries }) =>
      emit(new AgentLogReceivedEvent(agentId, entries)),
    );
    agents.on("config", status =>
      emit(new AgentConfigChangedEvent(AgentConfigStatusDto.fromModel(status))),
    );
    agents.on("action", action =>
      emit(
        new AgentActionFinishedEvent({
          id: action.id,
          agentId: action.agentId,
          name: action.name,
          ...(action.args && { args: action.args }),
          ...(action.actor && { actor: action.actor }),
          status: action.status,
          ...(action.result !== undefined && { result: action.result }),
          ...(action.error && { error: action.error }),
          createdAt: action.createdAt,
          finishedAt: action.finishedAt,
          ...(action.deferred && { deferred: true }),
        }),
      ),
    );
    agents.on("audit", entry => {
      emit(
        new AgentActionAuditedEvent(
          entry.action,
          entry.actor || null,
          String(entry.details?.worker ?? entry.agentId),
          entry.agentId,
          entry.details ?? {},
        ),
      );
      if (entry.action === "agent.delete") {
        this._connectedAt.delete(entry.agentId);
        this._running.delete(entry.agentId);
        emit(new AgentDeletedEvent(entry.agentId));
      }
    });
  }

  /**
   * Агент подключился к этому процессу с новым соединением или его воркер
   * снова зарегистрирован (перезапуск, обновление) — сверка его работ.
   */
  private detectReconnect(agent: Agent): void {
    if (!this.isLocal(agent) || agent.connectedAt === undefined) return;

    const running = new Map(
      agent.workers
        .filter(worker => worker.state === "running")
        .map(worker => [worker.name, worker.restarts ?? 0]),
    );
    const previous = this._running.get(agent.id);
    const restarted =
      !!previous &&
      [...running].some(([name, restarts]) => previous.get(name) !== restarts);
    const reconnected = this._connectedAt.get(agent.id) !== agent.connectedAt;

    this._running.set(agent.id, running);
    if (!reconnected && !restarted) return;

    this._connectedAt.set(agent.id, agent.connectedAt);
    for (const handler of this._reconnectHandlers) {
      try {
        handler(agent.id);
      } catch (err) {
        logger.warn(
          { err, agentId: agent.id },
          "[Agent] Обработчик подключения",
        );
      }
    }
  }

  /** Изменения в Store — сигналом другим процессам (`refresh`). */
  private share(agents: Agents): void {
    agents.on("change", ({ agentId }) => {
      this._outgoing.add(agentId);
      this._outgoingTimer ??= setTimeout(() => this.flush(), COALESCE_MS);
    });
  }

  private flush(): void {
    this._outgoingTimer = null;

    const { all, ids } = this._outgoing.take();
    const signal: TChangeSignal = {
      from: this._instanceId,
      all,
      ids: all ? [] : ids,
    };

    this._signals
      .notify(AGENTS_CHANGED_CHANNEL, JSON.stringify(signal))
      .catch(err =>
        logger.warn({ err }, "[Agent] Сигнал другим процессам не отправлен"),
      );
  }

  private onChanged(payload: string): void {
    const signal = parseJson(ChangeSignalSchema, payload);

    if (!signal || signal.from === this._instanceId || !this._agents) return;

    if (signal.all) this._incoming.add(undefined);
    for (const id of signal.ids) this._incoming.add(id);
    this._incomingTimer ??= setTimeout(() => this.refresh(), COALESCE_MS);
  }

  private refresh(): void {
    this._incomingTimer = null;

    const agents = this._agents;
    const { all, ids } = this._incoming.take();

    if (!agents) return;

    const done = all
      ? agents.refresh()
      : Promise.all(ids.map(id => agents.refresh(id)));

    done.catch(err =>
      logger.warn({ err }, "[Agent] refresh по сигналу не удался"),
    );
  }
}
