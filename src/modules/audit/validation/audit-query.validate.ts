import { z } from "zod";

const cursor = z.string().max(500, "Курсор слишком длинный").optional();
const limit = z.coerce.number().int().min(1).max(100).optional();
const type = z
  .string()
  .max(64, "Тип события не должен превышать 64 символа")
  .optional();

/** Query `GET /audit/my`. */
export const MyAuditQuerySchema = z.object({ cursor, limit, type });

/** Query `GET /audit`: плюс фильтр по пользователю. */
export const AuditQuerySchema = z.object({
  cursor,
  limit,
  type,
  actorId: z.uuid("Некорректный UUID").optional(),
});
