import pino, { Logger } from "pino";

import { config } from "../../config";
import { Injectable } from "../decorators";
import { getRequestId } from "./request-context";

const { level, pretty } = config.logging;

/** Поля с секретами на любой глубине объекта. */
const SECRET_FIELDS = [
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "token",
  "accessToken",
  "refreshToken",
  "twoFactorToken",
  "secretKey",
  "code",
  "otp",
  "authorization",
];

const redactPaths = SECRET_FIELDS.flatMap(field => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*.*.*.${field}`,
]);

export const logger: Logger = pino({
  level,
  base: { service: config.app.name },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  // requestId попадает в каждую запись внутри запроса — из AsyncLocalStorage.
  mixin: () => {
    const requestId = getRequestId();

    return requestId ? { requestId } : {};
  },
  transport: pretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:dd/mm/yyyy HH:MM:ss",
          ignore: "pid,hostname,service",
        },
      }
    : undefined,
});

/**
 * Injectable-обёртка над pino-логгером.
 * Предоставляет экземпляр pino напрямую — используйте нативный API pino.
 */
@Injectable()
export class LoggerService {
  readonly log: Logger = logger;
}
