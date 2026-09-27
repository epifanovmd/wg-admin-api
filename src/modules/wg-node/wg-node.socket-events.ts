/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgNodeDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Статус/состояние ноды изменились — в комнату ноды и в overview. */
    "wg:node:updated": (...args: [WgNodeDto]) => void;
  }
}
