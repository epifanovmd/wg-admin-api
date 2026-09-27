import type { IncomingMessage } from "http";
import { inject } from "inversify";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

import { config } from "../../config";
import {
  HttpException,
  HttpServer,
  IBootstrap,
  Injectable,
  JobQueue,
  logger,
} from "../../core";
import { WgNodeCommandService, WgNodeService } from "../wg-node";
import { WgViewerDemandService } from "../wg-stats";
import { wgAgentConfig } from "./wg-agent.config";
import { WgAgentLinkConnection } from "./wg-agent-link.connection";
import {
  EWgAgentLinkClose,
  WG_AGENT_LINK_MAX_MESSAGE_BYTES,
  WG_AGENT_LINK_PATH,
} from "./wg-agent-link.protocol";
import {
  IWgAgentLinkLostData,
  WG_AGENT_LINK_LOST_QUEUE,
} from "./wg-agent-link-lost.job";
import { WgAgentSessionService } from "./wg-agent-session.service";
import { WgAgentStateService } from "./wg-agent-state.service";
import { WG_NODE_CHANGED_CHANNEL, WgNodeSignals } from "./wg-node-signals";

/** Как часто пересматривается частота статистики агентов. */
const RATE_CHECK_MS = 2000;

/** Ответ на upgrade без установки соединения. */
const rejectUpgrade = (socket: Duplex, status: number): void => {
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Error"}\r\nConnection: close\r\n\r\n`,
  );
  socket.destroy();
};

/** Адрес агента: за прокси — первый `X-Forwarded-For`. */
const remoteIpOf = (req: IncomingMessage): string | undefined => {
  const forwarded = req.headers["x-forwarded-for"];

  if (config.server.trustProxy && typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim();
  }

  return req.socket.remoteAddress;
};

/**
 * Шлюз постоянной связи с агентами: WebSocket на пути канала рядом с HTTP API
 * (остальные upgrade-запросы достаются Socket.IO). Соединения живут в процессе,
 * который их принял; изменения нод приходят сигналами Postgres всем
 * процессам, поэтому состояние доставляется агенту, где бы ни произошло
 * изменение. Частота статистики — по спросу зрителей админки. Работает на
 * процессах с HTTP (`APP_ROLE=api|all`).
 */
@Injectable()
export class WgAgentLinkGateway implements IBootstrap {
  readonly critical = false;

  private _wss: WebSocketServer | null = null;
  private readonly _connections = new Map<string, Set<WgAgentLinkConnection>>();
  private readonly _timers: NodeJS.Timeout[] = [];
  private _offSignal: (() => void) | null = null;
  private _statsIntervalMs = wgAgentConfig.linkIdleStatsMs;
  private _stopping = false;

  constructor(
    @inject(HttpServer) private readonly _server: HttpServer,
    @inject(WgAgentSessionService)
    private readonly _session: WgAgentSessionService,
    @inject(WgAgentStateService)
    private readonly _state: WgAgentStateService,
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeSignals) private readonly _signals: WgNodeSignals,
    @inject(WgViewerDemandService)
    private readonly _demand: WgViewerDemandService,
    @inject(JobQueue) private readonly _jobs: JobQueue,
  ) {}

  async initialize(): Promise<void> {
    if (config.app.role === "worker") return;

    this._wss = new WebSocketServer({
      noServer: true,
      maxPayload: WG_AGENT_LINK_MAX_MESSAGE_BYTES,
    });
    this._server.on("upgrade", this._onUpgrade);
    this._offSignal = this._signals.on(WG_NODE_CHANGED_CHANNEL, nodeId => {
      this._connections.get(nodeId)?.forEach(link => link.notifyChanged());
    });
    this._timers.push(
      setInterval(
        () => this._each(link => link.heartbeat()),
        wgAgentConfig.linkHeartbeatMs,
      ),
      setInterval(() => void this._updateRate(), RATE_CHECK_MS),
      setInterval(
        () => this._each(link => void link.verifyKey()),
        wgAgentConfig.linkKeyCheckMs,
      ),
    );
  }

  async destroy(): Promise<void> {
    this._stopping = true;
    this._timers.forEach(timer => clearInterval(timer));
    this._offSignal?.();
    this._server.off("upgrade", this._onUpgrade);
    // Агенты переподключатся к другому процессу или к этому после рестарта.
    this._each(link =>
      link.close(EWgAgentLinkClose.Restart, "server restarting"),
    );
    await new Promise<void>(resolve =>
      this._wss ? this._wss.close(() => resolve()) : resolve(),
    );
  }

  /** Число открытых соединений агентов в этом процессе. */
  get connectionCount(): number {
    let count = 0;

    this._connections.forEach(links => (count += links.size));

    return count;
  }

  private readonly _onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path !== WG_AGENT_LINK_PATH || !this._wss) return;

    const rawKey = req.headers["x-api-key"];

    if (typeof rawKey !== "string" || !rawKey) {
      rejectUpgrade(socket, 401);

      return;
    }

    this._session
      .authenticate(rawKey)
      .then(identity => {
        this._wss!.handleUpgrade(req, socket, head, ws =>
          this._accept(ws, identity, rawKey, remoteIpOf(req)),
        );
      })
      .catch(err => {
        const status = err instanceof HttpException ? err.status : 500;

        if (status >= 500) logger.error({ err }, "[WG] agent link upgrade");
        rejectUpgrade(socket, status);
      });
  };

  private _accept(
    ws: WebSocket,
    identity: Awaited<ReturnType<WgAgentSessionService["authenticate"]>>,
    rawKey: string,
    remoteIp: string | undefined,
  ): void {
    const link = new WgAgentLinkConnection(
      ws,
      identity,
      rawKey,
      remoteIp,
      {
        session: this._session,
        state: this._state,
        commands: this._commands,
        nodes: this._nodes,
      },
      this._statsIntervalMs,
    );
    const nodeId = identity.node.id;
    const links = this._connections.get(nodeId) ?? new Set();

    links.add(link);
    this._connections.set(nodeId, links);
    logger.info({ nodeId, remoteIp }, "[WG] agent link connected");

    ws.on("close", code => {
      link.dispose();
      links.delete(link);
      if (links.size === 0) this._connections.delete(nodeId);
      logger.info({ nodeId, code }, "[WG] agent link closed");
      void this._scheduleOfflineCheck(nodeId);
    });
    ws.on("error", err =>
      logger.warn({ err, nodeId }, "[WG] agent link socket error"),
    );
  }

  /**
   * Разрыв: если за время ожидания агент не вернулся (новое соединение или
   * HTTP), нода — offline. Проверка — отложенной задачей очереди.
   */
  private async _scheduleOfflineCheck(nodeId: string): Promise<void> {
    if (this._connections.has(nodeId)) return;

    try {
      await this._jobs.enqueue<IWgAgentLinkLostData>(
        WG_AGENT_LINK_LOST_QUEUE,
        { nodeId, disconnectedAt: new Date().toISOString() },
        { startAfter: wgAgentConfig.linkOfflineGraceSec },
      );
    } catch (err) {
      if (!this._stopping) {
        logger.warn({ err, nodeId }, "[WG] agent link offline check");
      }
    }
  }

  private async _updateRate(): Promise<void> {
    if (this._connections.size === 0) return;

    try {
      const interval = (await this._demand.isWatched())
        ? wgAgentConfig.linkLiveStatsMs
        : wgAgentConfig.linkIdleStatsMs;

      this._statsIntervalMs = interval;
      this._each(link => link.setStatsInterval(interval));
    } catch (err) {
      logger.warn({ err }, "[WG] agent link rate");
    }
  }

  private _each(action: (link: WgAgentLinkConnection) => void): void {
    this._connections.forEach(links => links.forEach(action));
  }
}
