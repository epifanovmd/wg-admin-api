import {
  type ActionRecord,
  type Agent,
  type AgentEvent,
  Agents,
  type ConfigStatus,
  JOB_EVENTS,
  schemaProblems,
  type SchemaTarget,
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
import { AGENTS_CHANGED_CHANNEL, TAgentActionName } from "./agent.types";
import { agentAlerts, alertChanges, IAgentAlert } from "./agent-alerts";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AgentHistoryService, toAgentEventDto } from "./agent-history.service";
import { newerVersion } from "./agent-update-candidates";
import {
  AgentAlertDto,
  AgentConfigStatusDto,
  AgentDto,
  IAgentActionDto,
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
 * Имя копии в `agent.session.instance`: адрес API (уникален среди копий). Без
 * HTTP (роль `worker`) соединений агентов нет — узнаваемое уникальное имя.
 */
const newInstanceId = (): string =>
  config.app.role === "worker"
    ? `worker:${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`
    : urlOf(config.server.host, config.server.port);

/** Сколько отложенных действий помнить с автором (итог приходит позже). */
const MAX_DEFERRED_ACTORS = 1_000;

/** `actionId` отложенной замены воркера из ответа действия; нет — `undefined`. */
const deferredActionId = (result: unknown): string | undefined => {
  const value = result as { deferred?: unknown; actionId?: unknown } | null;

  return value?.deferred === true && typeof value.actionId === "string"
    ? value.actionId
    : undefined;
};

const actionKey = (agentId: string, name: string): string =>
  `${agentId}/${name}`;

type TWorkerEventHandler = (event: AgentEvent) => Promise<void>;

/**
 * `Agents` из agent-sdk — один на процесс: регистрация, WebSocket агентов,
 * запросы к воркерам, настройки, наблюдение, действия, раздача сборок воркеров
 * проекта.
 * Хранилище — Postgres (`AgentStore`). События SDK уходят в EventBus;
 * история (события воркеров, метрики) — в свои таблицы. Изменения в Store,
 * которые должен доставить процесс с соединением агента, — сигналом
 * `agents_changed` (каждый процесс вызывает `refresh`). Вызов, которому
 * нужна копия с соединением агента (запрос к воркеру, действия, наблюдение),
 * в другой копии — `AGENT_ELSEWHERE` (503 с `Retry-After`: клиент повторит,
 * липкий балансировщик приведёт его куда нужно). Аудит, проблемы агентов,
 * проверку по схемам манифеста и новую версию агента ведёт модуль.
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
  /** Проблемы агентов, о которых этот процесс уже сообщил. */
  private readonly _alerts = new Map<string, IAgentAlert[]>();
  /** Обработка событий агента по очереди: доменные события — в порядке SDK. */
  private readonly _queues = new Map<string, Promise<void>>();
  /** Новейшая версия агента, которую нашли агенты (`update.latest`). */
  private _latestAgentVersion: string | undefined;
  /** Авторы действий в работе: «агент/действие» → пользователи. */
  private readonly _actionActors = new Map<string, string[]>();
  /** Авторы отложенных действий: `actionId` → пользователь. */
  private readonly _deferredActors = new Map<string, string>();

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
   * Действие с агентом от имени пользователя (`actorId`; `null` — система):
   * запись «кто что сделал» (`AgentActionAuditedEvent`) и автор в итоге
   * действия (`AgentActionFinishedEvent`).
   */
  async act<T>(
    actorId: string | null,
    agentId: string,
    name: TAgentActionName,
    details: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.audit(name, actorId, agentId, details);
    if (!actorId) return fn();

    const key = actionKey(agentId, name);
    const actors = this._actionActors.get(key) ?? [];

    actors.push(actorId);
    this._actionActors.set(key, actors);
    try {
      const result = await fn();
      const actionId = deferredActionId(result);

      if (actionId) this.rememberDeferred(actionId, actorId);

      return result;
    } finally {
      actors.splice(actors.indexOf(actorId), 1);
      if (!actors.length) this._actionActors.delete(key);
    }
  }

  /** Кто что сделал с агентом: событие для журнала аудита. */
  audit(
    action: string,
    actorId: string | null,
    agentId: string,
    details: Record<string, unknown> = {},
  ): void {
    this._eventBus.emit(
      new AgentActionAuditedEvent(
        action,
        actorId || null,
        String(details.worker ?? agentId),
        agentId,
        details,
      ),
    );
  }

  /** Агент удалён: аудит, событие модулям, память процесса о нём. */
  deleted(actorId: string | null, agentId: string): void {
    this.audit("agent.delete", actorId, agentId);
    this._connectedAt.delete(agentId);
    this._running.delete(agentId);
    this._alerts.delete(agentId);
    this._eventBus.emit(new AgentDeletedEvent(agentId));
  }

  /**
   * Замечания к `data` по схеме манифеста воркера (`schemaProblems` SDK);
   * схему нельзя применить — журнал и пусто (проверять нечем).
   */
  schemaProblems(
    agent: Pick<Agent, "id" | "workers">,
    worker: string,
    target: SchemaTarget,
    data: unknown,
  ): string[] {
    try {
      return schemaProblems(agent, worker, target, data);
    } catch (err) {
      logger.warn(
        { err, agentId: agent.id, worker, target },
        "[Agent] Схема из манифеста воркера не применяется",
      );

      return [];
    }
  }

  /**
   * Текущие проблемы агента (`agentAlerts`): по его записи и статусам
   * настроек; `since` — как у проблем, о которых процесс уже сообщил.
   */
  async alertsOf(agent: Agent): Promise<IAgentAlert[]> {
    const configs: ConfigStatus[] = await this.agents
      .configStatus(agent.id)
      .catch(() => []);

    return agentAlerts(agent, configs, Date.now(), this._alerts.get(agent.id));
  }

  /** Агент для API: запись и текущие проблемы. */
  async toDto(agent: Agent): Promise<AgentDto> {
    return AgentDto.fromModel(agent, await this.alertsOf(agent));
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
      releasesDir: bundleReleasesDir(),
      trustProxy: config.server.trustProxy,
      onEvent: event => this.handleWorkerEvent(event),
      log: (msg, extra) => logger.info({ ...extra }, `[Agent] ${msg}`),
    });
  }

  /**
   * Событие воркера: проверка `data` по схеме манифеста
   * (`AGENT_VALIDATE_EVENTS`), обработчики модулей, затем история (с
   * замечаниями, если были); новое — в EventBus. Подтверждение агенту — после
   * успеха. Не по схеме: `log` — журнал, событие обрабатывается как обычно;
   * `reject` — журнал, событие только в историю.
   */
  private async handleWorkerEvent(event: AgentEvent): Promise<void> {
    const problems = await this.eventProblems(event);
    const rejected =
      problems.length > 0 && agentConfig.validateEvents === "reject";

    if (problems.length) {
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
    }
    if (!rejected) {
      for (const handler of this._eventHandlers) await handler(event);
    }
    if (await this._history.saveEvent(event, problems)) {
      this._eventBus.emit(
        new AgentEventReceivedEvent(toAgentEventDto(event, problems)),
      );
    }
  }

  /** Замечания к `data` события; события задач (`job.*`) не проверяются. */
  private async eventProblems(event: AgentEvent): Promise<string[]> {
    if (
      agentConfig.validateEvents === "off" ||
      (JOB_EVENTS as readonly string[]).includes(event.type)
    ) {
      return [];
    }

    const agent = await this.agents.getAgent(event.agentId);

    return agent
      ? this.schemaProblems(
          agent,
          event.worker,
          { event: event.type },
          event.data,
        )
      : [];
  }

  /** События SDK этого процесса → доменные события модуля. */
  private bridge(agents: Agents): void {
    const emit = this._eventBus.emit.bind(this._eventBus);

    agents.on("agent", agent => {
      // Регистрация: SDK сообщает о новом агенте в цепочке запроса enroll.
      const source = this._enrollment.takeSource();

      this.enqueue(agent.id, () => this.onAgent(agent, source));
    });
    agents.on("metrics", point =>
      emit(
        new AgentMetricsReceivedEvent(point.agentId, toMetricsPointDto(point)),
      ),
    );
    agents.on("log", ({ agentId, entries }) =>
      emit(new AgentLogReceivedEvent(agentId, entries)),
    );
    agents.on("config", status => {
      emit(new AgentConfigChangedEvent(AgentConfigStatusDto.fromModel(status)));
      this.enqueue(status.agentId, () => this.onConfigStatus(status));
    });
    agents.on("action", action =>
      emit(new AgentActionFinishedEvent(this.toActionDto(action))),
    );
  }

  /** По очереди на агента: доменные события агента — в порядке событий SDK. */
  private enqueue(agentId: string, fn: () => Promise<void>): void {
    const run = (this._queues.get(agentId) ?? Promise.resolve())
      .then(fn)
      .catch(err =>
        logger.warn({ err, agentId }, "[Agent] Событие агента не обработано"),
      );

    this._queues.set(agentId, run);
    void run.then(() => {
      if (this._queues.get(agentId) === run) this._queues.delete(agentId);
    });
  }

  /** Агент изменился: проблемы, событие модулям, регистрация, сверка работ, новая версия. */
  private async onAgent(
    agent: Agent,
    source: ReturnType<AgentEnrollmentService["takeSource"]>,
  ): Promise<void> {
    const dto = AgentDto.fromModel(agent, await this.trackAlerts(agent));

    this._eventBus.emit(new AgentUpdatedEvent(dto));
    if (source) {
      this.audit("agent.enroll", null, agent.id, { name: agent.name });
      this._eventBus.emit(new AgentEnrolledEvent(dto, source));
    }
    this.detectReconnect(agent);
    this.detectRelease(agent);
  }

  /** Статус ключа настроек: проблема `configFailed` началась или закончилась. */
  private async onConfigStatus(status: ConfigStatus): Promise<void> {
    const key = `configFailed:${status.worker}/${status.key}`;
    const known = this._alerts.get(status.agentId);

    if (
      !known ||
      (status.state === "failed") === known.some(alert => alert.key === key)
    ) {
      return;
    }

    const agent = await this.agents.getAgent(status.agentId);

    if (agent) await this.trackAlerts(agent);
  }

  /**
   * Пересчитать проблемы агента и сообщить, какие начались и закончились.
   * Первый раз после запуска процесса — без сообщений: о прежних проблемах
   * уже сообщили.
   */
  private async trackAlerts(agent: Agent): Promise<IAgentAlert[]> {
    const previous = this._alerts.get(agent.id);
    const alerts = await this.alertsOf(agent);

    this._alerts.set(agent.id, alerts);
    for (const change of previous ? alertChanges(previous, alerts) : []) {
      this._eventBus.emit(
        new AgentAlertChangedEvent(AgentAlertDto.fromModel(change)),
      );
    }

    return alerts;
  }

  /**
   * Агент нашёл новую версию агента (`update.latest`) новее всех известных
   * процессу — запись в журнал и событие `AgentReleaseChangedEvent`.
   */
  private detectRelease(agent: Agent): void {
    const latest = agent.update?.latest;
    const previous = this._latestAgentVersion;

    if (!latest || (previous && !newerVersion(latest, previous))) return;

    this._latestAgentVersion = latest;
    logger.info(
      { version: latest, previous, agentId: agent.id },
      "[Agent] Новая версия агента",
    );
    this._eventBus.emit(
      new AgentReleaseChangedEvent({
        version: latest,
        ...(previous && { previous }),
        from: `agent:${agent.name}`,
      }),
    );
  }

  /** Итог действия для модулей: автор — из `act`. */
  private toActionDto(action: ActionRecord): IAgentActionDto {
    const actor =
      this._deferredActors.get(action.id) ??
      this._actionActors.get(actionKey(action.agentId, action.name))?.[0];

    this._deferredActors.delete(action.id);

    return {
      id: action.id,
      agentId: action.agentId,
      name: action.name,
      ...(action.args && { args: action.args }),
      ...(actor && { actor }),
      status: action.status,
      ...(action.result !== undefined && { result: action.result }),
      ...(action.error && { error: action.error }),
      createdAt: action.createdAt,
      finishedAt: action.finishedAt,
      ...(action.deferred && { deferred: true }),
    };
  }

  private rememberDeferred(actionId: string, actorId: string): void {
    this._deferredActors.set(actionId, actorId);
    if (this._deferredActors.size > MAX_DEFERRED_ACTORS) {
      const oldest = this._deferredActors.keys().next().value;

      if (oldest !== undefined) this._deferredActors.delete(oldest);
    }
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
