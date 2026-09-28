/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { AuditEventDto } from "./audit.dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Новая запись журнала — в общий журнал и автору. */
    "audit:created": (...args: [AuditEventDto]) => void;
  }
}
