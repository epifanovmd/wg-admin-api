import type { Context, Next } from "koa";

import { config } from "../../config";
import { defaultErrorCode } from "../http/exceptions";
import { httpErrorsTotal, httpRequestDuration } from "./metrics";

/** Пробы и сам `/metrics` не попадают в метрики запросов. */
const SKIP_PATHS = new Set(["/ping", "/ready", "/health", "/metrics"]);

/** Запрос без маршрута (404, сканеры) — одна метка вместо URL. */
export const UNMATCHED_ROUTE = "unmatched";

const errorCode = (ctx: Context): string => {
  const code = (ctx.body as { code?: unknown } | undefined)?.code;

  return typeof code === "string" ? code : defaultErrorCode(ctx.status);
};

const record = (ctx: Context, status: number, end: (l: object) => void) => {
  const route = (ctx as { _matchedRoute?: unknown })._matchedRoute;

  end({
    method: ctx.method,
    route: typeof route === "string" ? route : UNMATCHED_ROUTE,
    status: String(status),
  });

  if (status >= 400) {
    httpErrorsTotal.inc({ code: errorCode(ctx), status: String(status) });
  }
};

/**
 * Метрики HTTP: длительность по методу, шаблону маршрута и статусу, счётчик
 * ошибок по коду. Подключается первым middleware — видит итоговый статус и
 * тело ошибки после error middleware.
 */
export const metricsMiddleware = async (ctx: Context, next: Next) => {
  if (!config.observability.metricsEnabled || SKIP_PATHS.has(ctx.path)) {
    return next();
  }

  const end = httpRequestDuration.startTimer();

  try {
    await next();
  } catch (err) {
    record(ctx, 500, end);
    throw err;
  }

  record(ctx, ctx.status, end);
};
