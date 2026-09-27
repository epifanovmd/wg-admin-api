/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgEndpointDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Точка подключения создана/изменена — в комнату списка точек. */
    "wg:endpoint:updated": (...args: [WgEndpointDto]) => void;
    /** Точка подключения удалена. */
    "wg:endpoint:deleted": (...args: [{ id: string }]) => void;
  }
}
