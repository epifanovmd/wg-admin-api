import type { ServerResponse } from "http";
import { inject } from "inversify";
import { hostname } from "os";

import { config } from "../../config";
import { Injectable } from "../decorators";
import { EventBus } from "../event-bus";
import { logger } from "../logger";
import { Agent } from "./agent.entity";
import { AgentConnectedEvent, AgentUpdatedEvent } from "./agent.events";
import { AgentRepository } from "./agent.repository";
import { AgentSignals } from "./agent.signals";
import { AgentCommand } from "./agent-command.entity";
import { AgentCommandRepository } from "./agent-command.repository";
import { Agents } from "./agents.service";
import { IAgentCommand, IAgentDesired } from "./protocol";

/** Комментарий-пинг в потоке; агент считает поток оборванным после 45 с тишины. */
const PING_MS = 15_000;
/** Как часто копия отмечает свои потоки живыми (и проверяет их без сигналов). */
const TOUCH_MS = 20_000;
/** Длинный опрос — не дольше. */
const POLL_MAX_WAIT_MS = 60_000;

interface IStream {
  agentId: string;
  res: ServerResponse;
  sentRev: number;
  sentSeq: number;
  /** Идёт отправка; `again` — пришёл сигнал, отправить ещё раз. */
  busy: boolean;
  again: boolean;
  closed: boolean;
  ping: NodeJS.Timeout;
}

const toCommand = (c: AgentCommand): IAgentCommand => ({
  seq: Number(c.seq),
  id: c.id,
  type: c.type,
  args: c.args ?? undefined,
  deadline: c.deadlineAt ? c.deadlineAt.getTime() : undefined,
});

/**
 * Потоки агентов этой копии API (`GET /agent/v1/stream`, SSE) и длинный опрос: желаемое при
 * подключении и изменении, команды с `seq` больше последней доставленной. Изменения из
 * других копий приходят сигналом `agent_push`.
 */
@Injectable()
export class AgentStreams {
  /** Копия API: поток агента в БД помечен ею. */
  readonly instanceId = `${hostname()}:${config.server.port}`;

  private readonly _streams = new Map<string, IStream>();
  private readonly _waiters = new Map<string, Set<() => void>>();
  private _timer: NodeJS.Timeout | null = null;
  private _off: (() => void) | null = null;

  constructor(
    @inject(Agents) private readonly _agentsService: Agents,
    @inject(AgentRepository) private readonly _agents: AgentRepository,
    @inject(AgentCommandRepository)
    private readonly _commands: AgentCommandRepository,
    @inject(AgentSignals) private readonly _signals: AgentSignals,
    @inject(EventBus) private readonly _bus: EventBus,
  ) {}

  async start(): Promise<void> {
    // Потоки прежнего запуска этой копии оборвались вместе с ним.
    await this._agents.clearStreams(this.instanceId);
    this._off = this._signals.on("agent_push", id => this.kick(id));
    this._timer = setInterval(() => void this.tick(), TOUCH_MS);
    this._timer.unref();
  }

  async stop(): Promise<void> {
    this._off?.();
    if (this._timer) clearInterval(this._timer);
    for (const stream of [...this._streams.values()]) stream.res.end();
    await this._agents.clearStreams(this.instanceId).catch(() => undefined);
  }

  /** Открыть поток агента: желаемое, ждущие команды после `after`, затем по сигналам. */
  async open(agent: Agent, after: number, res: ServerResponse): Promise<void> {
    this._streams.get(agent.id)?.res.end();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    res.write(": ok\n\n");

    const stream: IStream = {
      agentId: agent.id,
      res,
      sentRev: 0,
      sentSeq: after,
      busy: false,
      again: false,
      closed: false,
      ping: setInterval(() => res.write(": ping\n\n"), PING_MS),
    };

    this._streams.set(agent.id, stream);
    res.on("close", () => void this.closed(stream));
    await this._agents.setStream(agent.id, this.instanceId);
    agent.streamInstance = this.instanceId;
    this._bus.emit(new AgentUpdatedEvent(agent, "online"));
    this._bus.emit(new AgentConnectedEvent(agent));
    await this.flush(stream);
  }

  /**
   * Длинный опрос: ждать новое желаемое (rev ≠ `rev`) или команды после `after` не дольше
   * `waitMs`.
   */
  async poll(
    agent: Agent,
    after: number,
    rev: number,
    waitMs: number,
  ): Promise<{ desired?: IAgentDesired; commands: IAgentCommand[] }> {
    const deadline = Date.now() + Math.min(waitMs, POLL_MAX_WAIT_MS);

    for (;;) {
      const fresh = await this._agents.findById(agent.id);

      if (!fresh || fresh.revokedAt) return { commands: [] };
      const commands = (await this._commands.findPending(agent.id, after)).map(
        toCommand,
      );
      const desired =
        fresh.desiredRev !== rev
          ? await this._agentsService.desired(fresh)
          : undefined;

      if (commands.length || desired || Date.now() >= deadline)
        return { desired, commands };
      await new Promise<void>(resolve => {
        const waiters = this._waiters.get(agent.id) ?? new Set();
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(deadline - Date.now(), 5_000));

        waiters.add(done);
        this._waiters.set(agent.id, waiters);
      });
    }
  }

  /** У агента новое: отправить в его поток или разбудить его опрос. */
  kick(agentId: string): void {
    const stream = this._streams.get(agentId);

    if (stream) void this.flush(stream);
    for (const wake of [...(this._waiters.get(agentId) ?? [])]) wake();
  }

  /** Агенты с потоком в этой копии. */
  get connected(): string[] {
    return [...this._streams.keys()];
  }

  private async flush(stream: IStream): Promise<void> {
    if (stream.busy) {
      stream.again = true;

      return;
    }
    stream.busy = true;
    try {
      do {
        stream.again = false;
        const agent = await this._agents.findById(stream.agentId);

        if (!agent || agent.revokedAt) {
          stream.res.end();

          return;
        }
        if (agent.desiredRev !== stream.sentRev) {
          const desired = await this._agentsService.desired(agent);

          this.send(stream, String(desired.rev), "desired", desired);
          stream.sentRev = desired.rev;
        }
        for (const c of await this._commands.findPending(
          agent.id,
          stream.sentSeq,
        )) {
          this.send(stream, `c-${c.seq}`, "command", toCommand(c));
          stream.sentSeq = Number(c.seq);
        }
      } while (stream.again && !stream.closed);
    } catch (err) {
      logger.warn(
        { err, agentId: stream.agentId },
        "[Agent] Поток: отправка не удалась",
      );
    } finally {
      stream.busy = false;
    }
  }

  private send(
    stream: IStream,
    id: string,
    event: string,
    data: unknown,
  ): void {
    if (stream.closed) return;
    stream.res.write(
      `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }

  private async closed(stream: IStream): Promise<void> {
    stream.closed = true;
    clearInterval(stream.ping);
    if (this._streams.get(stream.agentId) !== stream) return;
    this._streams.delete(stream.agentId);
    await this._agents
      .setStream(stream.agentId, null, this.instanceId)
      .catch(() => undefined);
    const agent = await this._agents.findById(stream.agentId).catch(() => null);

    if (agent && !this._streams.has(agent.id))
      this._bus.emit(new AgentUpdatedEvent(agent, "offline"));
  }

  /** Отметить потоки живыми; без LISTEN — проверить их на новое опросом. */
  private async tick(): Promise<void> {
    for (const stream of this._streams.values()) {
      await this._agents
        .setStream(stream.agentId, this.instanceId)
        .catch(() => undefined);
      if (!this._signals.isListening) void this.flush(stream);
    }
  }
}
