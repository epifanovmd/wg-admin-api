import { Context, Next } from "koa";

import { LONG_POLL_STATE } from "../core/http";
import { logger } from "../core/logger";

const SLOW_REQUEST_THRESHOLD_MS = 2000;

/** Пробы оркестратора: вызываются каждые несколько секунд и забили бы лог. */
const SILENT_PATHS = new Set(["/ping", "/ready"]);

export const requestLoggerMiddleware = async (ctx: Context, next: Next) => {
  if (SILENT_PATHS.has(ctx.path)) return next();

  const start = Date.now();
  const { method, url } = ctx.request;
  // requestId подмешивает сам логгер (AsyncLocalStorage), child не нужен.
  const reqLogger = logger;

  try {
    await next();
  } finally {
    const durationMs = Date.now() - start;
    const { status } = ctx;
    const userId = (ctx.state.user as { userId?: string } | undefined)?.userId;

    const data = {
      method,
      url,
      status,
      durationMs,
      ...(userId && { userId }),
    };

    if (status >= 500) {
      reqLogger.error(data, `${method} ${url} ${status}`);
    } else if (status >= 400) {
      reqLogger.warn(data, `${method} ${url} ${status}`);
    } else if (
      durationMs > SLOW_REQUEST_THRESHOLD_MS &&
      !ctx.state[LONG_POLL_STATE]
    ) {
      reqLogger.warn(
        { ...data, slow: true },
        `${method} ${url} ${status} — slow request`,
      );
    } else {
      reqLogger.info(data, `${method} ${url} ${status}`);
    }
  }
};
