import { inject } from "inversify";

import { Injectable, TokenService } from "../../core";
import { ForbiddenException } from "../../core/http";
import {
  ISocketAuthRefreshAck,
  ISocketAuthRefreshPayload,
  TSocket,
} from "./socket.types";

/** Сколько ждать `auth:refresh` после `auth:expired`, прежде чем разорвать соединение. */
export const SOCKET_AUTH_GRACE_MS = 30_000;

/** Предел `setTimeout` (~24,8 суток); более долгий срок перепланируется. */
const MAX_TIMER_MS = 2_147_483_647;

type Lifetime = {
  /** Срок текущего access-токена соединения, мс. */
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Аутентификация сокета access-токеном и контроль его срока: по истечении
 * клиент получает `auth:expired` и `SOCKET_AUTH_GRACE_MS` на `auth:refresh`
 * с новым токеном той же сессии, иначе соединение закрывается.
 */
@Injectable()
export class SocketAuthMiddleware {
  private readonly _lifetimes = new WeakMap<TSocket, Lifetime>();

  constructor(
    @inject(TokenService)
    private readonly tokenService: TokenService,
  ) {}

  readonly handle = async (
    socket: TSocket,
    next: (err?: Error) => void,
  ): Promise<void> => {
    const token = this.extractToken(socket);

    if (!token) {
      return next(new ForbiddenException("Authentication token required"));
    }

    try {
      const { context, expiresAt } =
        await this.tokenService.verifyAccess(token);

      socket.data = context;
      this._lifetimes.set(socket, { expiresAt: expiresAt.getTime() });
      next();
    } catch (err) {
      next(
        new ForbiddenException(
          err instanceof Error ? err.message : "Invalid token",
        ),
      );
    }
  };

  /**
   * Следить за сроком токена подключённого сокета и принимать `auth:refresh`.
   * Вызывается один раз на соединение, после `handle`.
   */
  watch(socket: TSocket): void {
    if (!this._lifetimes.has(socket)) return;

    this._schedule(socket);

    socket.on("auth:refresh", async (payload, ack) => {
      const result = await this._refresh(socket, payload);

      if (typeof ack === "function") ack(result);
    });

    socket.on("disconnect", () => this._clear(socket));
  }

  private async _refresh(
    socket: TSocket,
    payload: ISocketAuthRefreshPayload | undefined,
  ): Promise<ISocketAuthRefreshAck> {
    const life = this._lifetimes.get(socket);
    const token =
      typeof payload?.accessToken === "string"
        ? payload.accessToken.replace(/^Bearer\s+/i, "")
        : "";

    if (!life || !token) {
      return { ok: false, error: "Требуется accessToken" };
    }

    try {
      const { context, expiresAt } =
        await this.tokenService.verifyAccess(token);

      if (
        context.userId !== socket.data.userId ||
        context.sessionId !== socket.data.sessionId
      ) {
        return { ok: false, error: "Токен другой сессии" };
      }

      socket.data = { ...context, subscriptions: socket.data.subscriptions };
      life.expiresAt = expiresAt.getTime();
      this._schedule(socket);

      return { ok: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Неверный токен",
      };
    }
  }

  private _schedule(socket: TSocket): void {
    const life = this._lifetimes.get(socket);

    if (!life) return;

    this._clearTimers(life);

    const delay = Math.min(
      Math.max(life.expiresAt - Date.now(), 0),
      MAX_TIMER_MS,
    );

    life.expiryTimer = setTimeout(() => this._onExpiry(socket), delay);
    life.expiryTimer.unref?.();
  }

  private _onExpiry(socket: TSocket): void {
    const life = this._lifetimes.get(socket);

    if (!life) return;

    if (life.expiresAt > Date.now()) {
      this._schedule(socket);

      return;
    }

    socket.emit("auth:expired", { graceMs: SOCKET_AUTH_GRACE_MS });
    life.graceTimer = setTimeout(
      () => socket.disconnect(true),
      SOCKET_AUTH_GRACE_MS,
    );
    life.graceTimer.unref?.();
  }

  private _clear(socket: TSocket): void {
    const life = this._lifetimes.get(socket);

    if (life) this._clearTimers(life);
    this._lifetimes.delete(socket);
  }

  private _clearTimers(life: Lifetime): void {
    if (life.expiryTimer) clearTimeout(life.expiryTimer);
    if (life.graceTimer) clearTimeout(life.graceTimer);
    life.expiryTimer = undefined;
    life.graceTimer = undefined;
  }

  private extractToken(socket: TSocket): string | null {
    const raw: unknown = socket.handshake.auth?.token;

    if (typeof raw !== "string" || !raw) return null;

    return raw.replace(/^Bearer\s+/i, "") || null;
  }
}
