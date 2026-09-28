import { inject, multiInject, optional } from "inversify";

import { Injectable, logger } from "../../core";
import type { ISocketData, ISocketRoomPayload } from "./socket.types";
import { userSocketRoom } from "./socket-emitter.service";
import { ISocketRoomPolicy, SOCKET_ROOM_POLICY } from "./socket-rooms";
import { SocketServerService } from "./socket-server.service";

/** Сокет для подписок: локальный или удалённый (другая реплика). */
interface IRoomSocket {
  data: ISocketData;
  rooms: Set<string>;
  join(room: string): unknown;
  leave(room: string): unknown;
  emit(event: "room:revoked", payload: ISocketRoomPayload): unknown;
}

/**
 * Подписки сокетов на комнаты сущностей по политикам модулей. Подписка
 * запоминается в `socket.data.subscriptions`: права проверяются не только при
 * входе — `revalidateUser` снимает подписки, на которые у пользователя больше
 * нет права (смена прав, смена владельца сущности), на всех репликах.
 */
@Injectable()
export class SocketRoomService {
  private readonly _policies: Map<string, ISocketRoomPolicy>;

  constructor(
    @inject(SocketServerService) private readonly _server: SocketServerService,
    @multiInject(SOCKET_ROOM_POLICY)
    @optional()
    policies: ISocketRoomPolicy[] = [],
  ) {
    this._policies = new Map(policies.map(p => [p.type, p]));
  }

  /** Войти в комнату сущности по политике; `false` — нет права или типа. */
  async subscribe(
    socket: IRoomSocket,
    type: unknown,
    id: unknown,
  ): Promise<boolean> {
    const policy = typeof type === "string" ? this._policies.get(type) : null;

    if (!policy || typeof id !== "string") return false;
    if (!(await this._allowed(policy, socket.data.userId, id))) return false;

    const room = policy.room(id);

    socket.join(room);
    socket.data.subscriptions = {
      ...socket.data.subscriptions,
      [room]: { type: policy.type, id },
    };

    return true;
  }

  unsubscribe(socket: IRoomSocket, type: unknown, id: unknown): void {
    const policy = typeof type === "string" ? this._policies.get(type) : null;

    if (!policy || typeof id !== "string") return;

    const room = policy.room(id);
    const { [room]: _removed, ...rest } = socket.data.subscriptions ?? {};

    socket.leave(room);
    socket.data.subscriptions = rest;
  }

  /**
   * Перепроверить подписки всех сокетов пользователя: из комнат без права
   * сокет выходит и получает `room:revoked { type, id }`.
   */
  async revalidateUser(userId: string): Promise<void> {
    const sockets = (await this._server.io
      .in(userSocketRoom(userId))
      .fetchSockets()) as unknown as IRoomSocket[];
    const verdicts = new Map<string, Promise<boolean>>();

    for (const socket of sockets) {
      const subscriptions = Object.entries(socket.data.subscriptions ?? {});

      for (const [room, target] of subscriptions) {
        if (!socket.rooms.has(room)) continue;

        const policy = this._policies.get(target.type);
        const verdict =
          verdicts.get(room) ??
          (policy
            ? this._allowed(policy, userId, target.id)
            : Promise.resolve(false));

        verdicts.set(room, verdict);

        if (!(await verdict)) {
          socket.leave(room);
          socket.emit("room:revoked", target);
        }
      }
    }
  }

  private async _allowed(
    policy: ISocketRoomPolicy,
    userId: string,
    id: string,
  ): Promise<boolean> {
    try {
      return await policy.canJoin(userId, id);
    } catch (err) {
      logger.warn(
        { err, type: policy.type, id },
        "[Socket] Room policy failed",
      );

      return false;
    }
  }
}
