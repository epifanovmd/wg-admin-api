/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { IWgSocksLive, WgSocksServiceDto } from "./dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Прокси создан/изменён — в комнату списка прокси. */
    "wg:socks:updated": (...args: [WgSocksServiceDto]) => void;
    /** Прокси удалён. */
    "wg:socks:deleted": (...args: [{ id: string }]) => void;
    /** Соединения и трафик прокси. */
    "wg:socks:stats": (...args: [{ id: string; live: IWgSocksLive }]) => void;
  }
}
