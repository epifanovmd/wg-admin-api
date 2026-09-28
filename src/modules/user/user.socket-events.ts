import type { UserDto } from "./dto";

/**
 * Сокет-события модуля: дополняют контракт `socket.types` (declare module
 * работает только с модулем-объявлением, не с index).
 */
export interface ISocketUserEmailChangedPayload {
  email: string;
}

export interface ISocketUserEmailVerifiedPayload {
  verified: boolean;
}

export interface ISocketUserPasswordChangedPayload {
  userId: string;
  method: "change" | "reset";
}

export interface ISocketUserPrivilegesChangedPayload {
  roles: string[];
  permissions: string[];
}

export interface ISocketUserUsernameChangedPayload {
  userId: string;
  username: string | null;
}

declare module "../socket/socket.types" {
  interface ISocketEmitEvents {
    /** Email пользователя подтверждён */
    "user:email-verified": (...args: [ISocketUserEmailVerifiedPayload]) => void;
    /** Email пользователя сменён (после подтверждения кодом) */
    "user:email-changed": (...args: [ISocketUserEmailChangedPayload]) => void;
    /** Пароль изменён */
    "user:password-changed": (
      ...args: [ISocketUserPasswordChangedPayload]
    ) => void;
    /** Привилегии пользователя изменены */
    "user:privileges-changed": (
      ...args: [ISocketUserPrivilegesChangedPayload]
    ) => void;
    /** Пользователь создан или изменён — в комнату списка пользователей */
    "user:updated": (...args: [UserDto]) => void;
    /** Пользователь удалён — в комнату списка пользователей */
    "user:deleted": (...args: [{ id: string }]) => void;
    /** Username пользователя изменён */
    "user:username-changed": (
      ...args: [ISocketUserUsernameChangedPayload]
    ) => void;
  }
}
