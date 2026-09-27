import { createAdapter } from "@socket.io/redis-adapter";
import { inject } from "inversify";
import type { Redis } from "ioredis";
import { Server } from "socket.io";

import {
  createRedisClient,
  HttpServer,
  Injectable,
  isRedisConfigured,
  logger,
} from "../../core";
import { isAllowedOrigin } from "../../middleware/cors.middleware";
import { TServer } from "./socket.types";

/** Сервис, инкапсулирующий экземпляр Socket.IO Server и управляющий его жизненным циклом. */
@Injectable()
export class SocketServerService {
  private readonly _io: TServer;
  private readonly _adapterClients: Redis[] = [];

  constructor(@inject(HttpServer) httpServer: HttpServer) {
    this._io = new Server(httpServer, {
      // Та же политика origin, что и у HTTP (`isAllowedOrigin`).
      cors: {
        origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket"],
      serveClient: false,
      pingTimeout: 10000,
      pingInterval: 25000,
      cookie: false,
    });

    // С Redis комнаты и emit общие для всех реплик: сообщение пользователю
    // доходит до его сокетов, где бы они ни были подключены.
    if (isRedisConfigured()) {
      const pub = createRedisClient("socket-pub");
      const sub = createRedisClient("socket-sub");

      this._adapterClients.push(pub, sub);
      this._io.adapter(createAdapter(pub, sub));
      logger.info("[Socket] Redis adapter enabled");
    }
  }

  /** Получить экземпляр Socket.IO сервера. */
  get io(): TServer {
    return this._io;
  }

  /**
   * Закрыть все соединения. Socket.IO заодно закрывает HTTP-сервер; если
   * App уже закрыл его сам, это не ошибка.
   */
  async close(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        this._io.close(err => {
          const code = (err as NodeJS.ErrnoException | undefined)?.code;

          if (err && code !== "ERR_SERVER_NOT_RUNNING") return reject(err);

          logger.info("[Socket] Server closed");
          resolve();
        });
      });
    } finally {
      await Promise.all(this._adapterClients.map(client => client.quit()));
    }
  }
}
