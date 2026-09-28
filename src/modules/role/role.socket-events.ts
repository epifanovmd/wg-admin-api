/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { IRoleDto } from "./role.dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Роль создана или изменены её права — в комнату списка ролей. */
    "role:updated": (...args: [IRoleDto]) => void;
    /** Роль удалена — в комнату списка ролей. */
    "role:deleted": (...args: [{ id: string }]) => void;
  }
}
