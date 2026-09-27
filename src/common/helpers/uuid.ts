const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строка — UUID в каноническом виде (8-4-4-4-12), любой версии. */
export const isUuid = (value: string): boolean => UUID_RE.test(value);
