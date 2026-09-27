import type { ErrorReporter } from "./error-reporter";
import { setErrorReporter } from "./error-reporter";

type SentryNode = typeof import("@sentry/node");

export interface SentryOptions {
  dsn: string;
  environment: string;
  serverName: string;
  release?: string;
}

/**
 * Обработчики процесса ставит `main.ts` и сам отправляет ошибки через
 * `reportProcessError`: встроенные интеграции Sentry дали бы дубли и
 * собственную логику выхода.
 */
const EXCLUDED_INTEGRATIONS = new Set([
  "OnUncaughtException",
  "OnUnhandledRejection",
]);

/**
 * Sentry только для ошибок, без трассировки. Пакет грузится лениво — без DSN
 * не тянется в процесс.
 */
export const initSentry = ({
  dsn,
  environment,
  serverName,
  release,
}: SentryOptions): ErrorReporter => {
  const Sentry = require("@sentry/node") as SentryNode;

  Sentry.init({
    dsn,
    environment,
    serverName,
    release,
    integrations: defaults =>
      defaults.filter(i => !EXCLUDED_INTEGRATIONS.has(i.name)),
  });

  const reporter: ErrorReporter = {
    capture: (err, { source, userId, ...extra }) => {
      Sentry.withScope(scope => {
        scope.setTag("source", source);
        if (extra.route) scope.setTag("route", extra.route);
        if (extra.requestId) scope.setTag("request_id", extra.requestId);
        if (userId) scope.setUser({ id: userId });
        scope.setContext("request", extra);
        Sentry.captureException(err);
      });
    },
    flush: async timeoutMs => {
      await Sentry.flush(timeoutMs);
    },
  };

  setErrorReporter(reporter);

  return reporter;
};
