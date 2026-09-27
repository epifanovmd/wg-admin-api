import { TokenProvider } from "../../core/decorators/module.decorator";

type Constructor<T = any> = new (...args: any[]) => T;

/**
 * Комнаты, в которые сокет пользователя входит сам при подключении (сущности,
 * участником которых он является). Модули регистрируют `asSocketRoomProvider(Cls)`;
 * модуль сокетов о доменах не знает.
 */
export const SOCKET_ROOM_PROVIDER = Symbol("SocketRoomProvider");

export interface ISocketRoomProvider {
  rooms(userId: string): Promise<string[]>;
}

/**
 * Право на подписку `room:subscribe { type, id }`: комнаты, в которые клиент
 * входит по запросу (экран проекта, прогресс задачи).
 */
export const SOCKET_ROOM_POLICY = Symbol("SocketRoomPolicy");

export interface ISocketRoomPolicy {
  /** Тип комнаты в запросе клиента: `job`, `project`. */
  readonly type: string;
  /** Имя комнаты Socket.IO для сущности. */
  room(id: string): string;
  canJoin(userId: string, id: string): Promise<boolean>;
}

export const asSocketRoomProvider = (
  cls: Constructor<ISocketRoomProvider>,
): TokenProvider<ISocketRoomProvider> => ({
  provide: SOCKET_ROOM_PROVIDER,
  useClass: cls,
});

export const asSocketRoomPolicy = (
  cls: Constructor<ISocketRoomPolicy>,
): TokenProvider<ISocketRoomPolicy> => ({
  provide: SOCKET_ROOM_POLICY,
  useClass: cls,
});
