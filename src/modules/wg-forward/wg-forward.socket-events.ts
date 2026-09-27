/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgForwardDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Проброс создан/изменён или сменил активный маршрут. */
    "wg:forward:updated": (...args: [WgForwardDto]) => void;
    /** Проброс удалён. */
    "wg:forward:deleted": (...args: [{ id: string }]) => void;
  }
}
