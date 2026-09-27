/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
export interface ISocketAuth2faChangedPayload {
  enabled: boolean;
}

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Изменение статуса 2FA */
    "auth:2fa-changed": (...args: [ISocketAuth2faChangedPayload]) => void;
  }
}
