/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgNodeDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Нода создана или изменена — в комнату списка нод и в комнату ноды. */
    "wg:node:updated": (...args: [WgNodeDto]) => void;
    /** Нода удалена — в комнату списка нод и в комнату ноды. */
    "wg:node:deleted": (...args: [{ id: string }]) => void;
  }
}
