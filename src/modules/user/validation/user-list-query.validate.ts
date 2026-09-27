import { z } from "zod";

/** Максимальный размер страницы списков пользователей. */
export const USER_LIST_MAX_LIMIT = 100;

const limit = z.coerce
  .number()
  .int("limit должен быть целым числом")
  .min(1, "limit должен быть не меньше 1")
  .max(USER_LIST_MAX_LIMIT, `limit не должен превышать ${USER_LIST_MAX_LIMIT}`)
  .optional();

const offset = z.coerce
  .number()
  .int("offset должен быть целым числом")
  .min(0, "offset не может быть отрицательным")
  .optional();

const searchQuery = z
  .string()
  .trim()
  .min(2, "Поисковый запрос должен содержать минимум 2 символа")
  .max(100, "Поисковый запрос не должен превышать 100 символов");

export const UserListQuerySchema = z.object({
  query: searchQuery.optional(),
  limit,
  offset,
});

export const UserOptionsQuerySchema = z.object({
  query: searchQuery.optional(),
});
