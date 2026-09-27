/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgInterfaceDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Интерфейс создан/изменён — в комнату интерфейса и overview. */
    "wg:interface:updated": (...args: [WgInterfaceDto]) => void;
    /** Интерфейс удалён. */
    "wg:interface:deleted": (...args: [{ id: string }]) => void;
  }
}
