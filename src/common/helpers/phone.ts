/** Телефон в хранимом виде: `+7XXXXXXXXXX` (E.164 для РФ). */
export const PHONE_RE = /^\+7\d{10}$/;

/** Форматы, которые принимаем на входе: `+7XXXXXXXXXX`, `8XXXXXXXXXX`, `7XXXXXXXXXX`. */
export const PHONE_INPUT_RE = /^(\+7|8|7)\d{10}$/;

/**
 * Единая нормализация телефона для регистрации, входа и обновления профиля:
 * пробелы, скобки и дефисы убираются, `8…`/`7…` приводятся к `+7…`.
 * Невалидное значение возвращается как есть — его отклонит валидация.
 */
export const normalizePhone = (value: string): string => {
  const compact = value.replace(/[\s()-]/g, "");

  if (!PHONE_INPUT_RE.test(compact)) return compact;

  return `+7${compact.slice(-10)}`;
};
