import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { inject, multiInject, optional } from "inversify";
import { isDeepStrictEqual } from "util";

import { Injectable } from "../decorators";
import { EventBus } from "../event-bus";
import { logger } from "../logger";
import {
  IWorkerRequestHandler,
  WORKER_REQUEST_HANDLER,
  WorkerRequestError,
} from "../worker-requests";
import { agentConfig } from "./agent.config";
import { Agent } from "./agent.entity";
import {
  AgentCommandFinishedEvent,
  AgentCommandProgressEvent,
  AgentConfigAppliedEvent,
  AgentEnrolledEvent,
  AgentEventReceivedEvent,
  AgentLogReceivedEvent,
  AgentMetricsReceivedEvent,
  AgentUpdatedEvent,
} from "./agent.events";
import { AgentRepository } from "./agent.repository";
import { AgentSignals } from "./agent.signals";
import { AgentCommandRepository } from "./agent-command.repository";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AgentEventRepository } from "./agent-event.repository";
import { AgentMetricRepository } from "./agent-metric.repository";
import { schemaProblems } from "./agent-schemas";
import { newAgentId, workerManifest } from "./agents.service";
import {
  AGENT_EVENT_COMMAND_PROGRESS,
  AgentCommandType,
  AgentProtocolCode,
  IAgentAccepted,
  IAgentEnroll,
  IAgentEvent,
  IAgentHello,
  IAgentHelloReply,
  IAgentLogEntry,
  IAgentMetrics,
  IAgentProgress,
  IAgentRequest,
  IAgentRequestReply,
  IAgentResult,
  IAgentState,
} from "./protocol";

/** Отказ протокола: HTTP-код и `{ code, message }`. */
export class AgentProtocolError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentProtocolError";
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const AGENT_NAME_MAX = 128;
const REQUEST_TIMEOUT_MAX_MS = 5 * 60_000;

/**
 * Сторона бэкенда протокола агента (кроме транспорта): регистрация, вход по ключу и всё, что
 * агент присылает вверх. Транспорт (HTTP, SSE) — `AgentLinkHandler` и `AgentStreams`.
 */
@Injectable()
export class AgentProtocolService {
  private readonly _requestHandlers = new Map<string, IWorkerRequestHandler>();

  constructor(
    @inject(AgentRepository) private readonly _agents: AgentRepository,
    @inject(AgentCommandRepository)
    private readonly _commands: AgentCommandRepository,
    @inject(AgentEventRepository)
    private readonly _events: AgentEventRepository,
    @inject(AgentMetricRepository)
    private readonly _metrics: AgentMetricRepository,
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
    @inject(AgentSignals) private readonly _signals: AgentSignals,
    @inject(EventBus) private readonly _bus: EventBus,
    @multiInject(WORKER_REQUEST_HANDLER)
    @optional()
    requestHandlers: IWorkerRequestHandler[] = [],
  ) {
    for (const handler of requestHandlers ?? []) {
      if (this._requestHandlers.has(handler.type)) {
        throw new Error(
          `Запрос воркеров «${handler.type}» зарегистрирован дважды`,
        );
      }
      this._requestHandlers.set(handler.type, handler);
    }
  }

  /** Регистрация по токену: новый агент и его ключ (секрет — только здесь). */
  async enroll(
    body: IAgentEnroll,
    remoteIp: string | null,
  ): Promise<{ agentId: string; secret: string }> {
    const name =
      typeof body?.name === "string"
        ? body.name.trim().slice(0, AGENT_NAME_MAX)
        : "";
    const source =
      typeof body?.token === "string" && name
        ? await this._enrollment.enroll(body.token, { name })
        : null;

    if (!source) {
      logger.warn({ ip: remoteIp, name }, "[Agent] Регистрация отклонена");
      throw new AgentProtocolError(
        401,
        AgentProtocolCode.ENROLL_DENIED,
        "Токен регистрации не принят",
      );
    }

    const secret = randomBytes(24).toString("hex");
    const agent = await this._agents.save(
      this._agents.create({
        id: newAgentId(),
        name,
        labels: { ...(body.labels ?? {}), ...source.labels },
        tokenLabels: source.labels,
        secretHash: sha256(secret),
        pendingSecretHash: null,
        host: body.host ?? null,
        hello: null,
        state: null,
        metrics: null,
        watch: null,
        streamInstance: null,
        lastSeenAt: null,
        remoteIp,
        revokedAt: null,
        enrollTokenId: source.tokenId,
      }),
    );

    logger.info(
      { agentId: agent.id, name, ip: remoteIp },
      "[Agent] Зарегистрирован",
    );
    this._bus.emit(new AgentEnrolledEvent(agent, source));

    return { agentId: agent.id, secret };
  }

  /**
   * Агент по заголовку `Authorization: Agent <agentId>.<secret>`. Ожидающий секрет (после
   * `agent.rotateKey`) становится основным при первом входе с ним.
   */
  async authenticate(
    header: string | undefined,
    remoteIp: string | null,
  ): Promise<Agent> {
    const [scheme, credentials = ""] = (header ?? "").split(" ", 2);
    const dot = credentials.indexOf(".");
    const id = dot > 0 ? credentials.slice(0, dot) : "";
    const agent =
      scheme === "Agent" && /^[0-9a-f]{32}$/.test(id)
        ? await this._agents.findById(id)
        : null;

    if (!agent)
      throw new AgentProtocolError(
        401,
        AgentProtocolCode.AGENT_UNKNOWN,
        "Ключ агента не известен",
      );
    const hash = sha256(credentials.slice(dot + 1));

    if (agent.pendingSecretHash && sameHash(hash, agent.pendingSecretHash)) {
      agent.secretHash = hash;
      agent.pendingSecretHash = null;
      await this._agents.update(
        { id },
        { secretHash: hash, pendingSecretHash: null },
      );
      logger.info({ agentId: id }, "[Agent] Новый секрет принят");
    } else if (!sameHash(hash, agent.secretHash)) {
      throw new AgentProtocolError(
        401,
        AgentProtocolCode.AGENT_UNKNOWN,
        "Ключ агента не известен",
      );
    }
    if (agent.revokedAt)
      throw new AgentProtocolError(
        403,
        AgentProtocolCode.AGENT_REVOKED,
        "Агент отозван",
      );
    agent.lastSeenAt = new Date();
    agent.remoteIp = remoteIp;
    await this._agents.touch(id, remoteIp);

    return agent;
  }

  async hello(agent: Agent, body: IAgentHello): Promise<IAgentHelloReply> {
    agent.hello = body;
    agent.host = body.host ?? agent.host;
    if (body.name) agent.name = String(body.name).slice(0, AGENT_NAME_MAX);
    agent.labels = { ...(body.labels ?? {}), ...agent.tokenLabels };
    await this._agents.update(
      { id: agent.id },
      {
        hello: body as never,
        host: agent.host,
        name: agent.name,
        labels: agent.labels,
      },
    );
    this._bus.emit(new AgentUpdatedEvent(agent, "hello"));

    return {
      status: "active",
      serverTime: Date.now(),
      stateMs: agentConfig.stateIntervalMs,
      metricsMs: agentConfig.metricsIntervalMs,
    };
  }

  async state(agent: Agent, body: IAgentState): Promise<void> {
    const previous = agent.state;

    agent.state = body;
    await this._agents.update({ id: agent.id }, { state: body as never });
    if (!isDeepStrictEqual(previous, body))
      this._bus.emit(new AgentUpdatedEvent(agent, "state"));

    for (const worker of body.workers ?? []) {
      const before =
        previous?.workers?.find(w => w.name === worker.name)?.configs ?? {};

      for (const [key, status] of Object.entries(worker.configs ?? {})) {
        if (status.ok === undefined || isDeepStrictEqual(before[key], status))
          continue;
        this._bus.emit(
          new AgentConfigAppliedEvent(
            agent.id,
            worker.name,
            key,
            status.version,
            status.ok,
            status.error,
          ),
        );
      }
    }
  }

  /** Итоги команд: записываются один раз; остальным копиям — сигнал `agent_result`. */
  async results(agent: Agent, items: IAgentResult[]): Promise<IAgentAccepted> {
    const accepted: string[] = [];

    for (const r of Array.isArray(items) ? items : []) {
      if (typeof r?.re !== "string") continue;
      accepted.push(r.re);
      const command = await this._commands.findById(r.re);

      if (!command || command.agentId !== agent.id) continue;
      const fresh = await this._commands.finish(
        r.re,
        Boolean(r.ok),
        r.result,
        r.ok
          ? null
          : (r.error ?? { code: "UNKNOWN", message: "итог без ошибки" }),
      );

      if (!fresh) continue;
      if (command.type === AgentCommandType.AGENT_ROTATE_KEY && r.ok) {
        const hash = (r.result as { secretHash?: string } | undefined)
          ?.secretHash;

        if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) {
          await this._agents.update(
            { id: agent.id },
            { pendingSecretHash: hash },
          );
        }
      }
      const done = await this._commands.findById(r.re);

      if (done) await this._bus.emitAsync(new AgentCommandFinishedEvent(done));
      await this._signals.notify("agent_result", r.re);
    }

    return { accepted };
  }

  /** События воркеров: новое — в историю и обработчикам; ход команды — в её запись. */
  async events(agent: Agent, items: IAgentEvent[]): Promise<IAgentAccepted> {
    const accepted: string[] = [];
    const rejected: IAgentAccepted["rejected"] = [];

    for (const e of Array.isArray(items) ? items : []) {
      if (
        typeof e?.id !== "string" ||
        typeof e.type !== "string" ||
        typeof e.worker !== "string"
      ) {
        if (typeof e?.id === "string")
          rejected.push({ id: e.id, reason: "нужны id, worker, type" });
        continue;
      }
      accepted.push(e.id);
      // Не по схеме — событие всё равно принимается (агент его не повторит), с замечаниями.
      const problems =
        e.type === AGENT_EVENT_COMMAND_PROGRESS
          ? []
          : schemaProblems(
              workerManifest(agent, e.worker)?.events?.find(
                x => x.type === e.type,
              )?.schema,
              e.data,
            );
      const fresh = await this._events.insertIfNew(
        this._events.create({
          agentId: agent.id,
          id: e.id.slice(0, 128),
          worker: e.worker.slice(0, 32),
          type: e.type.slice(0, 64),
          data: e.data === undefined ? null : (e.data as object),
          problems: problems.length ? problems : null,
          at: Number(e.at) || Date.now(),
          receivedAt: Date.now(),
        }),
      );

      if (!fresh) continue;
      if (e.type === AGENT_EVENT_COMMAND_PROGRESS) {
        await this.progress(agent, e.data as IAgentProgress);
      }
      await this._bus.emitAsync(new AgentEventReceivedEvent(agent.id, e));
    }

    return { accepted, rejected };
  }

  async metrics(agent: Agent, points: IAgentMetrics[]): Promise<void> {
    const list = (Array.isArray(points) ? points : []).filter(
      p => typeof p?.at === "number",
    );

    if (!list.length) return;
    const last = list[list.length - 1];

    await this._agents.update({ id: agent.id }, { metrics: last as never });
    const storedAt = (await this._metrics.findLastAt(agent.id)) ?? 0;
    let mark = storedAt;

    for (const point of list) {
      if (point.at - mark >= agentConfig.metricsStoreIntervalMs) {
        mark = point.at;
        await this._metrics.save(
          this._metrics.create({
            agentId: agent.id,
            at: point.at,
            host: point.host ?? null,
            workers: point.workers ?? null,
          }),
        );
      }
      this._bus.emit(new AgentMetricsReceivedEvent(agent.id, point));
    }
  }

  logs(agent: Agent, entries: IAgentLogEntry[]): void {
    const list = Array.isArray(entries) ? entries : [];

    if (list.length) this._bus.emit(new AgentLogReceivedEvent(agent.id, list));
  }

  /** Запрос воркера к бэкенду: обработчик модуля по типу (`WORKER_REQUEST_HANDLER`). */
  async request(
    agent: Agent,
    body: IAgentRequest,
  ): Promise<IAgentRequestReply> {
    const handler = this._requestHandlers.get(body?.type);

    if (!handler) {
      return {
        ok: false,
        error: {
          code: "REQUEST_UNHANDLED",
          message: `Сервер не обрабатывает запросы ${body?.type}`,
        },
      };
    }
    if (handler.workers && !handler.workers.includes(String(body.worker))) {
      return {
        ok: false,
        error: {
          code: "REQUEST_FORBIDDEN",
          message: `Запрос ${body.type} не принимается от воркера ${body.worker}`,
        },
      };
    }

    const declared = workerManifest(agent, String(body.worker))?.requests?.find(
      r => r.type === body.type,
    );
    const problems = schemaProblems(declared?.schema, body.data);

    if (problems.length) {
      return {
        ok: false,
        error: { code: "REQUEST_INVALID", message: problems.join("; ") },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(Number(body.timeoutMs) || 30_000, REQUEST_TIMEOUT_MAX_MS),
    );

    try {
      const data = await handler.handle({
        id: body.id ?? newAgentId(),
        agent: { id: agent.id, name: agent.name, labels: agent.labels },
        worker: String(body.worker),
        type: body.type,
        data: body.data,
        signal: controller.signal,
      });

      return { ok: true, data };
    } catch (err) {
      if (err instanceof WorkerRequestError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      logger.error(
        { err, agentId: agent.id, type: body.type },
        "[Agent] Обработчик запроса воркера упал",
      );

      return {
        ok: false,
        error: {
          code: "REQUEST_FAILED",
          message: "Сервер не смог ответить на запрос",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async progress(
    agent: Agent,
    p: IAgentProgress | undefined,
  ): Promise<void> {
    if (!p || typeof p.re !== "string") return;
    const command = await this._commands.findById(p.re);

    if (
      !command ||
      command.agentId !== agent.id ||
      command.status !== "pending"
    )
      return;
    const value = Math.min(Math.max(Number(p.progress) || 0, 0), 1);
    const text = typeof p.message === "string" ? p.message.slice(0, 200) : null;

    await this._commands.setProgress(p.re, value, text);
    command.progress = value;
    command.progressText = text;
    await this._bus.emitAsync(new AgentCommandProgressEvent(command));
  }
}
