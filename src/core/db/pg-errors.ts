import { QueryFailedError } from "typeorm";

/** SQLSTATE-коды Postgres, которые код обрабатывает осмысленно. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  INVALID_TEXT_REPRESENTATION: "22P02",
} as const;

/** Код ошибки драйвера Postgres или `undefined`, если это не ошибка запроса. */
export const pgErrorCode = (error: unknown): string | undefined =>
  error instanceof QueryFailedError
    ? (error.driverError as { code?: string } | undefined)?.code
    : undefined;

/** Нарушение уникального ограничения (гонка двух вставок и т. п.). */
export const isUniqueViolation = (error: unknown): boolean =>
  pgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION;

/** Имя нарушенного ограничения (индекса, FK) или `undefined`. */
export const pgConstraint = (error: unknown): string | undefined =>
  error instanceof QueryFailedError
    ? (error.driverError as { constraint?: string } | undefined)?.constraint
    : undefined;
