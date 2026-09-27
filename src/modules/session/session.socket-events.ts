/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { SessionDto } from "./session.dto";

export interface ISocketSessionPayload {
  sessionId: string;
}

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Новая сессия авторизована */
    "session:new": (...args: [SessionDto]) => void;
    /** Сессия завершена */
    "session:terminated": (...args: [ISocketSessionPayload]) => void;
  }
}
