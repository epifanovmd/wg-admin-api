import { inject } from "inversify";

import { Agents, Injectable, logger } from "../../core";
import { SocketServerService } from "../socket";
import { AGENT_WATCH, agentIdOfRoom, TAgentLogLevel } from "./agent.types";

const LEVEL_RANK: Record<TAgentLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Пока сокеты этой копии в комнате `agent_<id>`, агент под наблюдением (желаемое `watch`):
 * метрики раз в секунду, журнал — с самого подробного уровня зрителей. Срок наблюдения
 * продлевается, пока зрители есть; ушли — наблюдение истекает само.
 */
@Injectable()
export class AgentWatchService {
  /** agentId → socketId → уровень. */
  private readonly _viewers = new Map<string, Map<string, TAgentLogLevel>>();
  private _timer: NodeJS.Timeout | null = null;
  private _detach: (() => void) | null = null;

  constructor(
    @inject(SocketServerService) private readonly _server: SocketServerService,
    @inject(Agents) private readonly _agents: Agents,
  ) {}

  start(): void {
    const adapter = this._server.io.of("/").adapter;
    const onJoin = (room: string, socketId: string) =>
      this.join(room, socketId);
    const onLeave = (room: string, socketId: string) =>
      this.leave(room, socketId);

    adapter.on("join-room", onJoin);
    adapter.on("leave-room", onLeave);
    this._detach = () => {
      adapter.off("join-room", onJoin);
      adapter.off("leave-room", onLeave);
    };
    this._timer = setInterval(() => {
      for (const agentId of this._viewers.keys()) void this.renew(agentId);
    }, AGENT_WATCH.renewMs);
    this._timer.unref();
  }

  stop(): void {
    this._detach?.();
    if (this._timer) clearInterval(this._timer);
    this._viewers.clear();
  }

  /** Уровень журнала зрителя; `false` — сокет не смотрит агента. */
  setLogLevel(
    socketId: string,
    agentId: string,
    level: TAgentLogLevel,
  ): boolean {
    const viewers = this._viewers.get(agentId);

    if (!viewers?.has(socketId)) return false;
    viewers.set(socketId, level);
    void this.renew(agentId);

    return true;
  }

  private join(room: string, socketId: string): void {
    const agentId = agentIdOfRoom(room);

    if (!agentId) return;
    const viewers =
      this._viewers.get(agentId) ?? new Map<string, TAgentLogLevel>();

    viewers.set(socketId, AGENT_WATCH.logLevel);
    this._viewers.set(agentId, viewers);
    void this.renew(agentId);
  }

  private leave(room: string, socketId: string): void {
    const agentId = agentIdOfRoom(room);
    const viewers = agentId ? this._viewers.get(agentId) : undefined;

    if (!agentId || !viewers) return;
    viewers.delete(socketId);
    if (!viewers.size) this._viewers.delete(agentId);
  }

  private async renew(agentId: string): Promise<void> {
    const viewers = this._viewers.get(agentId);

    if (!viewers?.size) return;
    const level = [...viewers.values()].sort(
      (a, b) => LEVEL_RANK[a] - LEVEL_RANK[b],
    )[0];

    try {
      const agent = await this._agents.find(agentId);

      if (!agent || agent.revokedAt) return;
      const current = agent.watch;
      const fresh =
        current?.until &&
        current.until - Date.now() >
          AGENT_WATCH.ttlMs - AGENT_WATCH.renewMs - 5_000;

      if (fresh && current?.logLevel === level) return;
      await this._agents.setWatch(agentId, {
        metricsIntervalMs: AGENT_WATCH.metricsIntervalMs,
        logLevel: level,
        until: Date.now() + AGENT_WATCH.ttlMs,
      });
    } catch (err) {
      logger.warn(
        { err, agentId },
        "[Agent] Наблюдение за агентом не продлено",
      );
    }
  }
}
