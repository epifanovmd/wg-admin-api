import { defineErrors, HttpStatus } from "../../core";

export const ApiKeyError = defineErrors("APIKEY", {
  REQUIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: "Требуется API-ключ",
  },
  INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: "Неверный, отозванный или просроченный API-ключ",
  },
  SCOPE_DENIED: {
    status: HttpStatus.FORBIDDEN,
    message: "API-ключ не разрешает это действие",
  },
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "API-ключ не найден" },
});
