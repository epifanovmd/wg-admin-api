import type { WebSocket } from "ws";

import { logger } from "../../core";
import type { WgNodeCommandService, WgNodeService } from "../wg-node";
import { EWgAgentTransport } from "../wg-stats";
import { WgAgentError } from "./wg-agent.errors";
import {
  EWgAgentLinkClose,
  TWgAgentLinkIncoming,
  TWgAgentLinkOutgoing,
  WG_AGENT_LINK_HELLO_TIMEOUT_MS,
  WG_AGENT_LINK_PROTOCOL,
  WgAgentLinkIncomingSchema,
} from "./wg-agent-link.protocol";
import type {
  IWgAgentIdentity,
  WgAgentSessionService,
} from "./wg-agent-session.service";
import type { WgAgentStateService } from "./wg-agent-state.service";

/** Сервисы, с которыми работает соединение. */
export interface IWgAgentLinkDeps {
  session: WgAgentSessionService;
  state: WgAgentStateService;
  commands: WgNodeCommandService;
  nodes: WgNodeService;
}

/** Активность агента пишется в БД не чаще этого интервала. */
const TOUCH_INTERVAL_MS = 15_000;
/** Сигналы изменения ноды, пришедшие подряд, собираются в одну отправку. */
const STATE_DEBOUNCE_MS = 50;

/**
 * Одно соединение агента: сообщения обрабатываются строго по порядку (тики
 * статистики — в порядке номеров), состояние отправляется при изменении версии
 * конфигурации или появлении новых команд.
 */
export class WgAgentLinkConnection {
  private _queue: Promise<void> = Promise.resolve();
  private _greeted = false;
  private _alive = true;
  private _closed = false;
  private _sentVersion: number | null = null;
  private readonly _sentCommands = new Set<string>();
  private _touchedAt = 0;
  private _stateTimer: NodeJS.Timeout | null = null;
  private readonly _helloTimer: NodeJS.Timeout;

  constructor(
    private readonly _socket: WebSocket,
    private readonly _identity: IWgAgentIdentity,
    private readonly _rawKey: string,
    private readonly _remoteIp: string | undefined,
    private readonly _deps: IWgAgentLinkDeps,
    private _statsIntervalMs: number,
  ) {
    this._helloTimer = setTimeout(
      () => this.close(EWgAgentLinkClose.Protocol, "hello timeout"),
      WG_AGENT_LINK_HELLO_TIMEOUT_MS,
    );
    _socket.on("message", data => {
      const raw = data.toString();

      this._enqueue(() => this._onMessage(raw));
    });
    _socket.on("pong", () => {
      this._alive = true;
    });
  }

  get nodeId(): string {
    return this._identity.node.id;
  }

  /** Конфигурация ноды или её команды изменились — доставить состояние. */
  notifyChanged(): void {
    if (!this._greeted || this._closed || this._stateTimer) return;

    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      this._enqueue(() => this._pushState());
    }, STATE_DEBOUNCE_MS);
  }

  /** Сменить частоту статистики агента. */
  setStatsInterval(ms: number): void {
    if (ms === this._statsIntervalMs) return;

    this._statsIntervalMs = ms;
    if (this._greeted) this._send({ type: "rate", statsIntervalMs: ms });
  }

  /** Проверка живости: без pong с прошлой проверки — соединение мертво. */
  heartbeat(): void {
    if (this._closed) return;
    if (!this._alive) {
      this._socket.terminate();

      return;
    }

    this._alive = false;
    this._socket.ping();
  }

  /** Ключ отозван, истёк или сменился — соединение закрывается. */
  async verifyKey(): Promise<void> {
    if (this._closed) return;
    if (!(await this._deps.session.isKeyValid(this._rawKey, this.nodeId))) {
      this.close(EWgAgentLinkClose.Unauthorized, "key revoked");
    }
  }

  close(code: number, reason: string): void {
    if (this._closed) return;

    this._dispose();
    this._socket.close(code, reason);
  }

  /** Соединение закрыто (любой стороной) — освободить таймеры. */
  dispose(): void {
    this._dispose();
  }

  private _dispose(): void {
    this._closed = true;
    clearTimeout(this._helloTimer);
    if (this._stateTimer) clearTimeout(this._stateTimer);
  }

  private _enqueue(task: () => Promise<void>): void {
    this._queue = this._queue.then(task).catch(err => {
      logger.warn({ err, nodeId: this.nodeId }, "[WG] agent link message");
      this._send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async _onMessage(raw: string): Promise<void> {
    if (this._closed) return;

    let json: unknown;

    try {
      json = JSON.parse(raw);
    } catch {
      throw WgAgentError.LINK_MESSAGE_INVALID(undefined, "Сообщение — не JSON");
    }

    const parsed = WgAgentLinkIncomingSchema.safeParse(json);

    if (!parsed.success) {
      throw WgAgentError.LINK_MESSAGE_INVALID({
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    await this._handle(parsed.data as TWgAgentLinkIncoming);
  }

  private async _handle(message: TWgAgentLinkIncoming): Promise<void> {
    const { node } = this._identity;

    switch (message.type) {
      case "hello":
        clearTimeout(this._helloTimer);
        this._greeted = true;
        await this._touch(true);
        this._send({
          type: "welcome",
          protocol: WG_AGENT_LINK_PROTOCOL,
          statsIntervalMs: this._statsIntervalMs,
          serverTime: Date.now(),
        });
        this._sentVersion = message.knownVersion;
        this._sentCommands.clear();
        await this._pushState();

        return;
      case "report":
        await this._touch();
        await this._deps.session.report(node, message.report);

        return;
      case "stats":
        await this._touch();
        await this._deps.session.stats(
          node,
          message.stats,
          EWgAgentTransport.Link,
        );
        // Подтверждение — и для повтора: агент удаляет тик из буфера досылки.
        if (message.stats.seq !== undefined) {
          this._send({ type: "ack", seq: message.stats.seq });
        }

        return;
      case "command.ack":
        await this._deps.commands.ack(node, message.id);

        return;
      case "command.output":
        await this._deps.commands.appendOutput(node, message.id, message.chunk);

        return;
      case "command.complete":
        await this._deps.commands.complete(node, message.id, {
          exitCode: message.exitCode,
          error: message.error,
        });
    }
  }

  /** Отправить состояние, если версия новая или появились неотправленные команды. */
  private async _pushState(): Promise<void> {
    if (this._closed) return;

    const state = await this._deps.state.buildCurrent(this.nodeId);

    if (!state) {
      this.close(EWgAgentLinkClose.Unauthorized, "node deleted");

      return;
    }

    const newCommands = state.commands.some(
      command => !this._sentCommands.has(command.id),
    );

    if (state.version === this._sentVersion && !newCommands) return;

    this._send({ type: "state", state });
    this._sentVersion = state.version;
    state.commands.forEach(command => this._sentCommands.add(command.id));
    // Версия нужна приёму статистики: по ней обновляется карта пиров ноды.
    this._identity.node.configVersion = state.version;
  }

  private async _touch(force = false): Promise<void> {
    const now = Date.now();

    if (!force && now - this._touchedAt < TOUCH_INTERVAL_MS) return;

    this._touchedAt = now;
    await this._deps.nodes.touchAgent(this._identity.node, this._remoteIp);
  }

  private _send(message: TWgAgentLinkOutgoing): void {
    if (this._closed || this._socket.readyState !== this._socket.OPEN) return;

    this._socket.send(JSON.stringify(message));
  }
}
