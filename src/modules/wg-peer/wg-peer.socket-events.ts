/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { WgPeerDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Пир создан/изменён — в комнату списка пиров, пира и держателю. */
    "wg:peer:updated": (...args: [WgPeerDto]) => void;
    /** Пир удалён или ушёл от держателя (ему — адресно). */
    "wg:peer:deleted": (...args: [{ id: string }]) => void;
  }
}
