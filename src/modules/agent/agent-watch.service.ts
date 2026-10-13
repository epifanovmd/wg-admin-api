import type { Watch } from "agent-sdk/server";
import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { SocketServerService } from "../socket";
import { AgentRuntime } from "./agent.runtime";
import { AGENT_WATCH, agentIdOfRoom, TAgentLogLevel } from "./agent.types";

/** Сокет смотрит агента: наблюдатель SDK (продлевается сам до close). */
interface IWatch {
  agentId: string;
  socketId: string;
  level: TAgentLogLevel;
  /** Открытие наблюдателя; undefined — не открылся. */
  handle: Promise<Watch | undefined>;
}

/** Наблюдатель сокета: id — от сокета (уникален среди всех процессов). */
export const watchIdOf = (socketId: string): string => `socket:${socketId}`;

const watchKey = (socketId: string, agentId: string): string =>
  `${socketId}:${agentId}`;

/**
 * Пока сокет этого процесса в комнате `agent_<id>`, держит наблюдателя
 * `watch`: агент присылает метрики раз в секунду и журнал с уровня клиента.
 * Наблюдатель живёт в копии с соединением агента: в другой копии `watch` —
 * `AGENT_ELSEWHERE`, наблюдения нет (липкий балансировщик приводит сокет и
 * агента в одну копию). SDK продлевает его сам; снимается при выходе из
 * комнаты (и при отключении сокета); процесс упал — истекает сам.
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
      // Новые параметры — новым наблюдателем с тем же id.
      const previous = watch.handle;

      watch.level = level;
      watch.handle = previous
        .then(handle => handle?.close())
        .catch(() => {})
        .then(() => this.open(watch));
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
      handle: Promise.resolve(undefined),
    };

    watch.handle = this.open(watch);
    this._watches.set(key, watch);
  }

  private leave(room: string, socketId: string): void {
    const agentId = agentIdOfRoom(room);
    const watch = agentId && this._watches.get(watchKey(socketId, agentId));

    if (!watch) return;

    this._watches.delete(watchKey(socketId, watch.agentId));
    void this.unwatch(watch);
  }

  private async open(watch: IWatch): Promise<Watch | undefined> {
    try {
      return await this._runtime.agents.watch(watch.agentId, {
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

      return undefined;
    }
  }

  private async unwatch(watch: IWatch): Promise<void> {
    try {
      await (await watch.handle)?.close();
    } catch (err) {
      logger.warn(
        { err, agentId: watch.agentId },
        "[Agent] Наблюдение за агентом не снято",
      );
    }
  }
}
