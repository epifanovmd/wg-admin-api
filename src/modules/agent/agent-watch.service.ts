import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { SocketServerService } from "../socket";
import { AgentRuntime } from "./agent.runtime";
import { AGENT_WATCH, agentIdOfRoom, TAgentLogLevel } from "./agent.types";

/** Сокет смотрит агента: его наблюдатель и таймер продления. */
interface IWatch {
  agentId: string;
  socketId: string;
  level: TAgentLogLevel;
  timer: NodeJS.Timeout;
}

/** Наблюдатель сокета: id — от сокета (уникален среди всех процессов). */
export const watchIdOf = (socketId: string): string => `socket:${socketId}`;

const watchKey = (socketId: string, agentId: string): string =>
  `${socketId}:${agentId}`;

/**
 * Пока сокет этого процесса в комнате `agent_<id>`, держит наблюдателя
 * `watch`: агент присылает метрики раз в секунду и журнал с уровня клиента.
 * Наблюдатель живёт в копии с соединением агента: из другой копии SDK
 * пересылает вызов туда (`relay`). Продлевается (в том числе после
 * переподключения агента к другой копии) и снимается при выходе из комнаты
 * (и при отключении сокета); процесс упал — истекает сам.
 */
@Injectable()
export class AgentWatchService {
  private readonly _watches = new Map<string, IWatch>();
  private _detach: (() => void) | null = null;

  constructor(
    @inject(SocketServerService) private readonly _server: SocketServerService,
    @inject(AgentRuntime) private readonly _runtime: AgentRuntime,
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
  }

  async stop(): Promise<void> {
    this._detach?.();
    this._detach = null;

    const watches = [...this._watches.values()];

    this._watches.clear();
    await Promise.allSettled(watches.map(watch => this.unwatch(watch)));
  }

  /** Уровень журнала наблюдателя сокета; `false` — сокет не смотрит агента. */
  setLogLevel(
    socketId: string,
    agentId: string,
    level: TAgentLogLevel,
  ): boolean {
    const watch = this._watches.get(watchKey(socketId, agentId));

    if (!watch) return false;
    if (watch.level !== level) {
      watch.level = level;
      void this.renew(watch);
    }

    return true;
  }

  private join(room: string, socketId: string): void {
    const agentId = agentIdOfRoom(room);
    const key = agentId && watchKey(socketId, agentId);

    if (!agentId || !key || this._watches.has(key)) return;

    const watch: IWatch = {
      agentId,
      socketId,
      level: AGENT_WATCH.logLevel,
      timer: setInterval(() => void this.renew(watch), AGENT_WATCH.renewMs),
    };

    watch.timer.unref();
    this._watches.set(key, watch);
    void this.renew(watch);
  }

  private leave(room: string, socketId: string): void {
    const agentId = agentIdOfRoom(room);
    const watch = agentId && this._watches.get(watchKey(socketId, agentId));

    if (!watch) return;

    this._watches.delete(watchKey(socketId, watch.agentId));
    void this.unwatch(watch);
  }

  private async renew(watch: IWatch): Promise<void> {
    try {
      await this._runtime.agents.watch(watch.agentId, {
        id: watchIdOf(watch.socketId),
        metricsIntervalMs: AGENT_WATCH.metricsIntervalMs,
        logLevel: watch.level,
        ttlMs: AGENT_WATCH.ttlMs,
      });
    } catch (err) {
      logger.warn(
        { err, agentId: watch.agentId },
        "[Agent] Наблюдение за агентом не началось",
      );
    }
  }

  private async unwatch(watch: IWatch): Promise<void> {
    clearInterval(watch.timer);

    try {
      await this._runtime.agents.unwatch(
        watch.agentId,
        watchIdOf(watch.socketId),
      );
    } catch (err) {
      logger.warn(
        { err, agentId: watch.agentId },
        "[Agent] Наблюдение за агентом не снято",
      );
    }
  }
}
