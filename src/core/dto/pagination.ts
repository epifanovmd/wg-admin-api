export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/** Страница по смещению: списки с известным общим числом. */
export interface IPaginatedDto<T> {
  items: T[];
  /** Всего элементов, подходящих под фильтр. */
  total: number;
  offset: number;
  limit: number;
}

/**
 * Страница по курсору: ленты, где записи добавляются во время чтения
 * (сообщения, события). Курсор непрозрачен для клиента.
 */
export interface ICursorPageDto<T> {
  items: T[];
  /** Курсор следующей страницы; `null` — страниц больше нет. */
  nextCursor: string | null;
}

export interface Pagination {
  offset: number;
  limit: number;
}

/**
 * Смещение и лимит из query: отрицательные и нечисловые — к умолчаниям,
 * лимит не больше `PAGINATION_MAX_LIMIT`. Использовать в каждом списке —
 * без лимита запрос вернул бы всю таблицу.
 */
export const normalizePagination = (
  offset?: number,
  limit?: number,
): Pagination => ({
  offset: Number.isInteger(offset) && offset! > 0 ? offset! : 0,
  limit:
    Number.isInteger(limit) && limit! > 0
      ? Math.min(limit!, PAGINATION_MAX_LIMIT)
      : PAGINATION_DEFAULT_LIMIT,
});

export const toPage = <T>(
  items: T[],
  total: number,
  { offset, limit }: Pagination,
): IPaginatedDto<T> => ({ items, total, offset, limit });

/** Курсор — base64url от JSON; клиент передаёт его обратно как есть. */
export const encodeCursor = (value: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export const decodeCursor = <T extends Record<string, unknown>>(
  cursor: string | undefined,
): T | undefined => {
  if (!cursor) return undefined;

  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
};
