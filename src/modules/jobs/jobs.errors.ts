import { defineErrors, HttpStatus } from "../../core";

export const JobsError = defineErrors("JOB", {
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Задача не найдена" },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "Нет доступа к задаче",
  },
  NOT_CANCELLABLE: {
    status: HttpStatus.CONFLICT,
    message: "Задача уже завершена",
  },
  UNKNOWN_QUEUE: {
    status: HttpStatus.BAD_REQUEST,
    message: "Очередь не зарегистрирована",
  },
  REQUEST_TIMEOUT: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: "Задача не завершилась вовремя",
  },
  REQUEST_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    message: "Задача завершилась ошибкой",
  },
});
