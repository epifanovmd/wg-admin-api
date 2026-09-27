import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketEmitEvents } from "./socket.types";
import { SocketServerService } from "./socket-server.service";

/** Личная комната пользователя: в неё входит каждый его сокет. */
export const userSocketRoom = (userId: string): string => `user_${userId}`;

/** Сервис для отправки Socket.IO событий пользователям, комнатам и широковещательно. */
@Injectable()
export class SocketEmitterService {
  constructor(
    @inject(SocketServerService) private readonly server: SocketServerService,
  ) {}

  /**
   * Отправляет событие конкретному пользователю.
   * Работает для всех активных соединений пользователя (несколько вкладок/устройств)
   * через его личную комнату (`userSocketRoom`), в которую вступает каждый сокет.
   */
  toUser<K extends keyof ISocketEmitEvents>(
    userId: string,
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): void {
    this.server.io.to(userSocketRoom(userId)).emit<any>(event, ...args);
  }

  /** Отправляет событие всем клиентам в указанной комнате. */
  toRoom<K extends keyof ISocketEmitEvents>(
    room: string,
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): void {
    this.server.io.to(room).emit<any>(event, ...args);
  }

  /**
   * Событие комнате, кроме сокетов, которые состоят в комнатах `except`
   * (например, получили то же содержимое более полной рассылкой).
   */
  toRoomExcept<K extends keyof ISocketEmitEvents>(
    room: string,
    except: string | string[],
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): void {
    this.server.io
      .to(room)
      .except(except)
      .emit<any>(event, ...args);
  }

  /** Все сокеты пользователя (на всех репликах) входят в комнату. */
  joinRoom(userId: string, room: string): void {
    this.server.io.in(userSocketRoom(userId)).socketsJoin(room);
  }

  /** Все сокеты пользователя покидают комнату: покинул чат, забанен. */
  leaveRoom(userId: string, room: string): void {
    this.server.io.in(userSocketRoom(userId)).socketsLeave(room);
  }

  /** Разорвать все соединения пользователя: удалён, сменил пароль. */
  disconnectUser(userId: string): void {
    this.server.io.in(userSocketRoom(userId)).disconnectSockets(true);
  }

  /** Разорвать соединения конкретной сессии: сессия завершена. */
  async disconnectSession(userId: string, sessionId: string): Promise<void> {
    const sockets = await this.server.io
      .in(userSocketRoom(userId))
      .fetchSockets();

    for (const socket of sockets) {
      if (socket.data.sessionId === sessionId) socket.disconnect(true);
    }
  }

  /** Клиенты, подключённые к этому процессу (без учёта других реплик). */
  localClientsCount(): number {
    return this.server.io.engine.clientsCount;
  }

  /** Отправляет событие всем подключённым клиентам (broadcast). */
  broadcast<K extends keyof ISocketEmitEvents>(
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): void {
    this.server.io.emit<any>(event, ...args);
  }
}
