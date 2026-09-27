import { randomUUID } from "crypto";
import { Context, Next } from "koa";

import { isUuid } from "../common/helpers/uuid";
import { requestContext } from "../core/logger/request-context";

export const REQUEST_ID_HEADER = "X-Request-ID";

/**
 * Идентификатор запроса: из заголовка клиента (если это uuid) или новый.
 * Отдаётся в ответе и живёт в AsyncLocalStorage — логгер подмешивает его
 * во все записи, сделанные во время обработки запроса.
 */
export const requestIdMiddleware = (ctx: Context, next: Next) => {
  const incoming = ctx.request.headers[REQUEST_ID_HEADER.toLowerCase()];
  const requestId =
    typeof incoming === "string" && isUuid(incoming) ? incoming : randomUUID();

  ctx.set(REQUEST_ID_HEADER, requestId);
  ctx.state.requestId = requestId;

  return requestContext.run({ requestId }, next);
};
