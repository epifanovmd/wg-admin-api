import { Module } from "../../core";
import { OwnedEntityEmitter } from "./owned-entity-emitter";
import { SocketBootstrap } from "./socket.bootstrap";
import { SocketAuthMiddleware } from "./socket-auth.middleware";
import { SocketClientRegistry } from "./socket-client-registry";
import { SocketEmitterService } from "./socket-emitter.service";
import { SocketRoomService } from "./socket-room.service";
import { SocketServerService } from "./socket-server.service";

/**
 * Socket.IO инфраструктура: сервер, аутентификация, реестр клиентов, эмиттер.
 * SocketBootstrap запускает сервер и регистрирует всех ISocketHandler / ISocketEventListener.
 */
@Module({
  providers: [
    SocketServerService,
    SocketAuthMiddleware,
    SocketClientRegistry,
    SocketEmitterService,
    SocketRoomService,
    OwnedEntityEmitter,
  ],
  bootstrappers: [SocketBootstrap],
})
export class SocketModule {}
