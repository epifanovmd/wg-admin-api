import { z } from "zod";

import { defineErrors, HttpException, logger } from "../../core";
import {
  ISocketAckError,
  ISocketEvents,
  TSocket,
  TSocketAck,
} from "./socket.types";

export const SocketError = defineErrors("SOCKET", {
  RATE_LIMITED: { status: 429, message: "Слишком частые события" },
  INTERNAL: { status: 500, message: "Ошибка обработки события" },
});

/** Token bucket: `perSecond` токенов в секунду, запас — `burst`. */
export interface ISocketRateLimit {
  perSecond: number;
  /** Ёмкость ведра (сколько событий подряд); по умолчанию `perSecond`. */
  burst?: number;
}

export interface IOnValidatedOptions {
  rateLimit?: ISocketRateLimit;
}

interface IBucket {
  tokens: number;
  updatedAt: number;
}

/** Вёдра живут, пока жив сокет: WeakMap не держит отключённые сокеты. */
const buckets = new WeakMap<object, Map<string, IBucket>>();

/** Списать токен из ведра события; `false` — лимит исчерпан. */
export const takeSocketToken = (
  socket: object,
  event: string,
  { perSecond, burst = perSecond }: ISocketRateLimit,
  now = Date.now(),
): boolean => {
  let perSocket = buckets.get(socket);

  if (!perSocket) {
    perSocket = new Map();
    buckets.set(socket, perSocket);
  }

  const bucket = perSocket.get(event) ?? { tokens: burst, updatedAt: now };
  const refilled = Math.min(
    burst,
    bucket.tokens + ((now - bucket.updatedAt) / 1000) * perSecond,
  );

  if (refilled < 1) {
    perSocket.set(event, { tokens: refilled, updatedAt: now });

    return false;
  }

  perSocket.set(event, { tokens: refilled - 1, updatedAt: now });

  return true;
};

const toAckError = (err: unknown): ISocketAckError => {
  if (err instanceof HttpException) {
    return {
      code: err.code,
      message: err.message,
      ...(err.reason && typeof err.reason === "object"
        ? { details: err.reason }
        : {}),
    };
  }

  const internal = SocketError.INTERNAL();

  return { code: internal.code, message: internal.message };
};

const validationError = (error: z.ZodError): ISocketAckError => ({
  code: "VALIDATION_ERROR",
  message: "Ошибка валидации события",
  details: Object.fromEntries(
    error.issues.map(issue => [issue.path.join(".") || "_", issue.message]),
  ),
});

type TAckFn = (res: TSocketAck) => void;

/**
 * Подписка на событие клиента с проверкой частоты и схемы.
 *
 * - частота — token bucket на сокет и событие; превышение без ack
 *   молча отбрасывается (ответ `error` сам по себе удвоил бы трафик);
 * - вход проверяется Zod-схемой, в обработчик попадает результат парсинга;
 * - ошибка валидации или обработчика → ack `{ ok: false, error: { code,
 *   message } }`, без ack — событие `error` с тем же кодом;
 * - успех → ack `{ ok: true }` (с `data`, если обработчик что-то вернул).
 */
export const onValidated = <
  E extends keyof ISocketEvents & string,
  S extends z.ZodType,
>(
  socket: TSocket,
  event: E,
  schema: S,
  handler: (data: z.output<S>) => unknown,
  options: IOnValidatedOptions = {},
): void => {
  const reject = (error: ISocketAckError, ack: TAckFn | undefined) => {
    if (ack) ack({ ok: false, error });
    else
      socket.emit("error", { event, code: error.code, message: error.message });
  };

  const listener = async (...args: unknown[]) => {
    const ack =
      typeof args[args.length - 1] === "function"
        ? (args.pop() as TAckFn)
        : undefined;

    if (
      options.rateLimit &&
      !takeSocketToken(socket, event, options.rateLimit)
    ) {
      const limited = SocketError.RATE_LIMITED();

      ack?.({
        ok: false,
        error: { code: limited.code, message: limited.message },
      });

      return;
    }

    const parsed = await schema.safeParseAsync(args[0]);

    if (!parsed.success) {
      reject(validationError(parsed.error), ack);

      return;
    }

    try {
      const data = await handler(parsed.data);

      ack?.(data === undefined ? { ok: true } : { ok: true, data });
    } catch (err) {
      if (!(err instanceof HttpException)) {
        logger.error(
          { err, event, userId: socket.data?.userId },
          "[Socket] Event handler failed",
        );
      }

      reject(toAckError(err), ack);
    }
  };

  // Типизированный `on` не сужает generic-событие; форму данных гарантирует схема.
  socket.on(event, listener as never);
};
