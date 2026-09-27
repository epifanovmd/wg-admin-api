import type { Context } from "koa";

/** Контекст ошибки для трекера: запрос, пользователь, источник. */
export interface ErrorReportContext {
  requestId?: string;
  method?: string;
  path?: string;
  route?: string;
  status?: number;
  userId?: string;
  /** Откуда ошибка: `http`, `unhandledRejection`, `uncaughtException`, `job`. */
  source: string;
}

/** Трекер ошибок (Sentry или тестовый двойник). */
export interface ErrorReporter {
  capture(err: unknown, context: ErrorReportContext): void;
  /** Дождаться отправки накопленных событий. */
  flush(timeoutMs: number): Promise<void>;
}

let reporter: ErrorReporter | undefined;

/** Подключить трекер; `undefined` — выключить отправку. */
export const setErrorReporter = (next: ErrorReporter | undefined): void => {
  reporter = next;
};

export const isErrorReportingEnabled = (): boolean => reporter !== undefined;

/**
 * Хук error middleware: отправляет в трекер только 5xx — клиентские ошибки
 * (4xx) шумят и ошибками сервера не являются.
 */
export const reportError = (
  err: unknown,
  ctx: Context,
  status: number = ctx.status,
): void => {
  if (!reporter || status < 500) return;

  const route = (ctx as { _matchedRoute?: unknown })._matchedRoute;
  const user = (ctx.state?.user ??
    (ctx.request as { user?: unknown } | undefined)?.user) as
    { userId?: string } | undefined;

  reporter.capture(err, {
    source: "http",
    status,
    method: ctx.method,
    path: ctx.path,
    route: typeof route === "string" ? route : undefined,
    requestId: ctx.state?.requestId,
    userId: user?.userId,
  });
};

/** Ошибки процесса: `unhandledRejection`, `uncaughtException`. */
export const reportProcessError = (
  err: unknown,
  source: "unhandledRejection" | "uncaughtException",
): void => {
  reporter?.capture(err, { source });
};

/** Отправить накопленное (перед выходом процесса); без трекера — сразу. */
export const flushErrors = async (timeoutMs = 2_000): Promise<void> => {
  await reporter?.flush(timeoutMs).catch(() => undefined);
};
