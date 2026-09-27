/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { PublicProfileDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Профиль изменён — владельцу (синхронизация между устройствами). */
    "profile:updated": (...args: [PublicProfileDto]) => void;
  }
}
