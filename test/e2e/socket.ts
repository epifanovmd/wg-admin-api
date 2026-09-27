import { io, Socket } from "socket.io-client";

import type { Actor } from "./client";
import { BASE_URL } from "./harness";

export interface TestSocket {
  socket: Socket;
  /** `room:subscribe`: подтверждение сервера (`ok: false` — нет прав). */
  join: (type: string, id?: string) => Promise<{ ok: boolean }>;
  /** Первое событие, удовлетворяющее условию, иначе ошибка по таймауту. */
  next: <T = any>(
    event: string,
    match?: (payload: T) => boolean,
    timeoutMs?: number,
  ) => Promise<T>;
  /** Событий с условием не было за время ожидания. */
  none: <T = any>(
    event: string,
    match?: (payload: T) => boolean,
    waitMs?: number,
  ) => Promise<void>;
  close: () => void;
}

/** Сокет от имени участника (access-токен в handshake). */
export const connectSocket = async (actor: Actor): Promise<TestSocket> => {
  const socket = io(BASE_URL, {
    auth: { token: actor.access },
    transports: ["websocket"],
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });

  const next = <T>(
    event: string,
    match: (payload: T) => boolean = () => true,
    timeoutMs = 5_000,
  ) =>
    new Promise<T>((resolve, reject) => {
      const onEvent = (payload: T) => {
        if (!match(payload)) return;
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      };
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        reject(new Error(`нет события ${event} за ${timeoutMs} мс`));
      }, timeoutMs);

      socket.on(event, onEvent);
    });

  return {
    socket,
    join: (type, id = "all") =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`нет ответа на room:subscribe ${type}`)),
          3_000,
        );

        socket.emit("room:subscribe", { type, id }, (ack: { ok: boolean }) => {
          clearTimeout(timer);
          resolve(ack);
        });
      }),
    next,
    none: async (event, match, waitMs = 700) => {
      const got = await next(event, match, waitMs).then(
        () => true,
        () => false,
      );

      if (got) throw new Error(`лишнее событие ${event}`);
    },
    close: () => socket.close(),
  };
};
