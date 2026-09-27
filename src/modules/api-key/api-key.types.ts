/** Открытая часть ключа для поиска: 6 байт → 8 символов base64url. */
export const API_KEY_PREFIX_BYTES = 6;
export const API_KEY_PREFIX_LENGTH = 8;
/** Секрет: 32 байта → 43 символа base64url. */
export const API_KEY_SECRET_BYTES = 32;
/** Длиннее — заведомо не наш ключ. */
export const API_KEY_MAX_LENGTH = 128;
/** `lastUsedAt` обновляется не чаще раза в этот интервал. */
export const API_KEY_TOUCH_INTERVAL_MS = 60_000;
export const API_KEY_HEADER = "x-api-key";
export const API_KEY_AUTH_SCHEME = "ApiKey ";
