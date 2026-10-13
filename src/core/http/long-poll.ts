import type { KoaRequest } from "../../types/koa";

/**
 * Флаг `ctx.state` для long-poll: запрос ждёт намеренно, и логгер запросов не
 * считает его медленным.
 */
export const LONG_POLL_STATE = "longPoll";

/**
 * Long-poll запрос: помечает его для логгера и возвращает сигнал, который
 * срабатывает, когда клиент закрыл соединение, — ожидание пора снимать.
 */
export const longPollSignal = (req: KoaRequest): AbortSignal => {
  const controller = new AbortController();

  req.ctx.state[LONG_POLL_STATE] = true;
  req.ctx.req.once("close", () => controller.abort());

  return controller.signal;
};
