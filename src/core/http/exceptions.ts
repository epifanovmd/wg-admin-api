/**
 * HTTP-исключения приложения. Контракт ответа — `IErrorResponseDto`:
 * `status`, машинный `code` (стабилен, на него опирается клиент), человекочитаемый
 * `message`, необязательные `details`.
 *
 * Код: доменный (`defineErrors` → `USER_EMAIL_TAKEN`) или по статусу (`CONFLICT`).
 */

export const HttpStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/** Код ошибки по статусу, если доменный не задан. */
export const defaultErrorCode = (status: number): string => {
  const entry = Object.entries(HttpStatus).find(([, code]) => code === status);

  if (status === HttpStatus.INTERNAL_SERVER_ERROR) return "INTERNAL_ERROR";

  return entry ? entry[0] : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
};

export type HttpExceptionReason =
  string | Record<string, unknown> | Error | undefined;

export class HttpException extends Error {
  /** Машинный код ошибки для клиента. */
  public readonly code: string;

  constructor(
    public readonly message: string,
    public readonly status: number,
    public readonly reason?: HttpExceptionReason,
    code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code ?? defaultErrorCode(status);
  }
}

const define = (status: number, defaultMessage: string) =>
  class extends HttpException {
    constructor(
      message: string = defaultMessage,
      reason?: HttpExceptionReason,
      code?: string,
    ) {
      super(message, status, reason, code);
    }
  };

export class BadRequestException extends define(
  HttpStatus.BAD_REQUEST,
  "Некорректный запрос",
) {}
export class UnauthorizedException extends define(
  HttpStatus.UNAUTHORIZED,
  "Требуется аутентификация",
) {}
export class ForbiddenException extends define(
  HttpStatus.FORBIDDEN,
  "Недостаточно прав",
) {}
export class NotFoundException extends define(
  HttpStatus.NOT_FOUND,
  "Не найдено",
) {}
export class ConflictException extends define(
  HttpStatus.CONFLICT,
  "Конфликт с текущим состоянием",
) {}
export class GoneException extends define(
  HttpStatus.GONE,
  "Больше недоступно",
) {}
export class PayloadTooLargeException extends define(
  HttpStatus.PAYLOAD_TOO_LARGE,
  "Слишком большой запрос",
) {}
export class UnsupportedMediaTypeException extends define(
  HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  "Неподдерживаемый тип данных",
) {}
export class UnprocessableEntityException extends define(
  HttpStatus.UNPROCESSABLE_ENTITY,
  "Невозможно обработать запрос",
) {}
export class TooManyRequestsException extends define(
  HttpStatus.TOO_MANY_REQUESTS,
  "Слишком много запросов",
) {}
export class InternalServerErrorException extends define(
  HttpStatus.INTERNAL_SERVER_ERROR,
  "Внутренняя ошибка сервера",
) {}
export class NotImplementedException extends define(
  HttpStatus.NOT_IMPLEMENTED,
  "Не реализовано",
) {}
export class ServiceUnavailableException extends define(
  HttpStatus.SERVICE_UNAVAILABLE,
  "Сервис временно недоступен",
) {}

/** Ошибка валидации входа: поле → сообщение. */
export class ValidationException extends HttpException {
  constructor(
    fields: Record<string, string>,
    message = "Ошибка валидации запроса",
  ) {
    super(message, HttpStatus.BAD_REQUEST, fields, "VALIDATION_ERROR");
  }
}

export interface ErrorDefinition {
  status: number;
  message: string;
}

export type ErrorFactory = (
  details?: Record<string, unknown> | string,
  message?: string,
) => HttpException;

/**
 * Доменные ошибки модуля с машинными кодами `<PREFIX>_<KEY>`.
 *
 * @example
 * export const UserError = defineErrors("USER", {
 *   EMAIL_TAKEN: { status: 409, message: "Email уже используется" },
 * });
 * throw UserError.EMAIL_TAKEN();
 */
export const defineErrors = <K extends string>(
  prefix: string,
  definitions: Record<K, ErrorDefinition>,
): Record<K, ErrorFactory> & { codes: Record<K, string> } => {
  const factories = {} as Record<K, ErrorFactory>;
  const codes = {} as Record<K, string>;

  for (const key of Object.keys(definitions) as K[]) {
    const { status, message } = definitions[key];
    const code = `${prefix}_${key}`;

    codes[key] = code;
    factories[key] = (details, customMessage) =>
      new HttpException(customMessage ?? message, status, details, code);
  }

  return Object.assign(factories, { codes });
};
