import { TSocket } from "./socket.types";

export const SOCKET_HANDLER = Symbol("SocketHandler");

export interface ISocketHandler {
  onConnection(socket: TSocket): void | Promise<void>;
}
