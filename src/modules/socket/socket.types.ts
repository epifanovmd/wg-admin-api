import { Server, Socket as SocketIO } from "socket.io";

import { AuthContext } from "../../types/koa";

/**
 * Контракт событий Socket.IO. Здесь — только события самого соединения;
 * модули добавляют свои в `<feature>.socket-events.ts` дополнением интерфейсов:
 *
 * ```ts
 * declare module "../socket/socket.types" {
 *   interface ISocketEmitEvents { "chat:created": (...args: [ChatDto]) => void }
 * }
 * ```
 */

// ─── Payload-интерфейсы ──────────────────────────────────────────────────

/** Комната сущности для `room:subscribe`: `{ type: "job", id }`. */
export interface ISocketRoomPayload {
  type: string;
  id: string;
}

/** Подтверждение (ack) клиентского события: ошибка — с машинным кодом. */
export interface ISocketAckResponse {
  ok: boolean;
  error?: ISocketAckError;
}

/** Продление аутентификации сокета новым access-токеном той же сессии. */
export interface ISocketAuthRefreshPayload {
  accessToken: string;
}

export interface ISocketAuthRefreshAck {
  ok: boolean;
  /** Новый срок токена (ISO) при успехе. */
  expiresAt?: string;
  error?: string;
}

export interface ISocketAuthenticatedPayload {
  userId: string;
}

export interface ISocketAuthErrorPayload {
  message: string;
}

/** Access-токен сокета истёк: без `auth:refresh` соединение закроется через `graceMs`. */
export interface ISocketAuthExpiredPayload {
  graceMs: number;
}

export interface ISocketErrorEventPayload {
  event: string;
  message: string;
}

// ─── События Клиент → Сервер ─────────────────────────────────────────────

export interface ISocketEvents {
  /** Application-level heartbeat — клиент проверяет, что соединение живо */
  ping: (data: { ts: number }) => void;

  /** Продлить аутентификацию соединения новым access-токеном той же сессии */
  "auth:refresh": (
    data: ISocketAuthRefreshPayload,
    ack?: (res: ISocketAuthRefreshAck) => void,
  ) => void;

  /** Войти в комнату сущности (`job`, …) — по политике модуля */
  "room:subscribe": (
    data: ISocketRoomPayload,
    ack?: (res: ISocketAckResponse) => void,
  ) => void;
  /** Выйти из комнаты сущности */
  "room:unsubscribe": (
    data: ISocketRoomPayload,
    ack?: (res: ISocketAckResponse) => void,
  ) => void;
}

// ─── События Сервер → Клиент ─────────────────────────────────────────────

export interface ISocketEmitEvents {
  /** Application-level heartbeat ответ */
  pong: (...args: [{ ts: number }]) => void;

  /** Успешная аутентификация по JWT токену */
  authenticated: (...args: [ISocketAuthenticatedPayload]) => void;
  /** Ошибка аутентификации */
  auth_error: (...args: [ISocketAuthErrorPayload]) => void;
  /** Access-токен соединения истёк — клиент должен прислать `auth:refresh` */
  "auth:expired": (...args: [ISocketAuthExpiredPayload]) => void;

  /** Общая ошибка обработки socket-события */
  error: (...args: [ISocketErrorEventPayload]) => void;

  /** Права на комнату больше нет: сокет из неё выведен */
  "room:revoked": (...args: [ISocketRoomPayload]) => void;
}

// ─── Типы Socket ─────────────────────────────────────────────────────────────

/** Данные соединения: контекст токена и подписки на комнаты сущностей. */
export type ISocketData = AuthContext & {
  /** Комната Socket.IO → сущность, на которую подписан сокет. */
  subscriptions?: Record<string, ISocketRoomPayload>;
};

/** События между инстансами сервера (адаптер Redis и т.п.); шаблон их не задаёт. */
export type TInterServerEvents = Record<string, (...args: any[]) => void>;

export type TSocket = SocketIO<
  ISocketEvents,
  ISocketEmitEvents,
  TInterServerEvents,
  ISocketData
>;

export type TServer = Server<
  ISocketEvents,
  ISocketEmitEvents,
  TInterServerEvents,
  ISocketData
>;

// ─── Ack и ошибки обработчиков с валидацией (`onValidated`) ──────────────

/** Ошибка обработки события: машинный код и сообщение, как в HTTP. */
export interface ISocketAckError {
  code: string;
  message: string;
  /** Поля с ошибками валидации или доп. данные (`retryAfter`). */
  details?: unknown;
}

/** Ответ на событие с ack: `{ ok: true }` или `{ ok: false, error }`. */
export type TSocketAck<T = unknown> =
  { ok: true; data?: T } | { ok: false; error: ISocketAckError };

/** Машинный код в событии `error` (для событий без ack). */
export interface ISocketErrorEventPayload {
  code?: string;
}
