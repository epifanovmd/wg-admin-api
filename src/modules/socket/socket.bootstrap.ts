import { inject, multiInject, optional } from "inversify";

import { config } from "../../config";
import {
  EventBus,
  IBootstrap,
  Injectable,
  logger,
  trackSocketConnection,
} from "../../core";
import { UserOfflineEvent, UserOnlineEvent } from "../profile/events";
import { TSocket } from "./socket.types";
import { SocketAuthMiddleware } from "./socket-auth.middleware";
import { SocketClientRegistry } from "./socket-client-registry";
import { userSocketRoom } from "./socket-emitter.service";
import {
  ISocketEventListener,
  SOCKET_EVENT_LISTENER,
} from "./socket-event-listener.interface";
import { ISocketHandler, SOCKET_HANDLER } from "./socket-handler.interface";
import {
  ISocketRoomPolicy,
  ISocketRoomProvider,
  SOCKET_ROOM_POLICY,
  SOCKET_ROOM_PROVIDER,
} from "./socket-rooms";
import { SocketServerService } from "./socket-server.service";

@Injectable()
export class SocketBootstrap implements IBootstrap {
  constructor(
    @inject(SocketServerService)
    private readonly serverService: SocketServerService,
    @inject(SocketAuthMiddleware)
    private readonly authMiddleware: SocketAuthMiddleware,
    @inject(SocketClientRegistry)
    private readonly clientRegistry: SocketClientRegistry,
    @inject(EventBus)
    private readonly eventBus: EventBus,
    @multiInject(SOCKET_HANDLER)
    private readonly handlers: ISocketHandler[],
    @multiInject(SOCKET_EVENT_LISTENER)
    private readonly eventListeners: ISocketEventListener[],
    @multiInject(SOCKET_ROOM_PROVIDER)
    @optional()
    private readonly roomProviders: ISocketRoomProvider[] = [],
    @multiInject(SOCKET_ROOM_POLICY)
    @optional()
    private readonly roomPolicies: ISocketRoomPolicy[] = [],
  ) {}

  async initialize(): Promise<void> {
    const { io } = this.serverService;

    // Воркер клиентов не принимает, но слушатели событий шлют через
    // Redis-адаптер клиентам, подключённым к API-процессам.
    if (config.app.role === "worker") {
      this.registerListeners();

      return;
    }

    // 1. JWT-аутентификация при подключении
    io.use(this.authMiddleware.handle);

    // 2. Жизненный цикл соединения
    io.on("connection", async (socket: TSocket) => {
      trackSocketConnection(socket);
      const user = socket.data;

      // Синхронно, до первого await: клиент подписывается на комнаты сразу
      // после connect (в том числе при переподключении) — иначе запрос,
      // пришедший, пока идёт регистрация в Redis, теряется без ответа.
      this.registerRoomSubscriptions(socket);

      // Первое соединение (на любой реплике) → пользователь выходит в онлайн
      const wasOffline = !(await this.clientRegistry.isOnline(user.userId));

      await this.clientRegistry.register(user.userId, socket);
      // Личная room пользователя — через неё доставляются все push-уведомления.
      // SocketEmitterService.toUser() шлёт в неё, поэтому событие получат все
      // соединения (несколько вкладок/устройств).
      socket.join(userSocketRoom(user.userId));
      socket.emit("authenticated", { userId: user.userId });
      // Срок access-токена: auth:expired → auth:refresh или разрыв
      this.authMiddleware.watch(socket);

      // Комнаты модулей (чаты, пространства) — до доменных хендлеров,
      // чтобы сокет уже получал события; при reconnect восстанавливаются.
      const rooms = await Promise.allSettled(
        this.roomProviders.map(provider => provider.rooms(user.userId)),
      );

      for (const result of rooms) {
        if (result.status === "fulfilled") socket.join(result.value);
        else {
          logger.error(
            { err: result.reason, userId: user.userId },
            "[Socket] Room provider failed",
          );
        }
      }

      if (wasOffline) {
        this.eventBus.emit(new UserOnlineEvent(user.userId));
      }

      // Передаём управление domain-хендлерам
      const results = await Promise.allSettled(
        this.handlers.map(h => h.onConnection(socket)),
      );

      for (const result of results) {
        if (result.status === "rejected") {
          logger.error(
            { err: result.reason, userId: user.userId },
            "[Socket] Handler onConnection failed",
          );
        }
      }

      // Application-level heartbeat — клиент шлёт ping, сервер отвечает pong
      socket.on("ping", (data: { ts: number }) => {
        socket.emit("pong", { ts: data.ts });
      });

      socket.on("error", err => {
        logger.error({ err, userId: user.userId }, "[Socket] Socket error");
        socket.disconnect(true);
      });

      socket.on("disconnect", async reason => {
        logger.info(
          { userId: user.userId, reason },
          "[Socket] User disconnected",
        );

        try {
          // Снимаем именно это соединение; последнее → пользователь офлайн
          await this.clientRegistry.unregister(user.userId, socket);

          if (!(await this.clientRegistry.isOnline(user.userId))) {
            this.eventBus.emit(new UserOfflineEvent(user.userId));
          }
        } catch (err) {
          logger.error(
            { err, userId: user.userId },
            "[Socket] Presence update failed",
          );
        }
      });
    });

    this.clientRegistry.startHeartbeat();

    this.registerListeners();
  }

  /** EventBus → сокеты/push: на всех ролях процесса. */
  private registerListeners(): void {
    for (const listener of this.eventListeners) {
      try {
        listener.register();
      } catch (error) {
        logger.error(
          { err: error },
          `[Socket] Event listener registration failed: ${listener.constructor.name}`,
        );
      }
    }
  }

  /**
   * `room:subscribe { type, id }` — вход в комнату по политике модуля;
   * неизвестный тип или нет права — `ok: false`, комната не раскрывается.
   */
  private registerRoomSubscriptions(socket: TSocket): void {
    const policies = new Map(this.roomPolicies.map(p => [p.type, p]));
    const { userId } = socket.data;

    socket.on("room:subscribe", async (payload, ack) => {
      const policy = policies.get(payload?.type);
      const allowed =
        !!policy &&
        typeof payload?.id === "string" &&
        (await policy.canJoin(userId, payload.id).catch(() => false));

      if (allowed) socket.join(policy!.room(payload.id));
      ack?.({ ok: allowed });
    });

    socket.on("room:unsubscribe", (payload, ack) => {
      const policy = policies.get(payload?.type);

      if (policy && typeof payload?.id === "string") {
        socket.leave(policy.room(payload.id));
      }
      ack?.({ ok: true });
    });
  }

  /** Подписки EventBus снимает App последним шагом остановки. */
  async destroy(): Promise<void> {
    await this.serverService.close();
    await this.clientRegistry.stop();
  }
}
