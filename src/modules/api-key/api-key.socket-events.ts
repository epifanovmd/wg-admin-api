/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { ApiKeyDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Ключ выпущен или отозван — в комнату списка ключей. */
    "apikey:updated": (...args: [ApiKeyDto]) => void;
  }
}
