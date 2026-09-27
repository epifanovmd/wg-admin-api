/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
import type { JobRunDto } from "./dto/job-run.dto";

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Видимая задача изменилась: статус, прогресс, лог */
    "job:updated": (...args: [JobRunDto]) => void;
  }
}
