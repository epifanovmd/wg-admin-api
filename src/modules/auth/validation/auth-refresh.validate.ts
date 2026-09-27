import { z } from "zod";

/** Токен в теле необязателен: его может принести httpOnly-cookie. */
export const RefreshSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "Refresh токен не может быть пустым")
    .max(2000, "Refresh токен слишком длинный")
    .optional(),
});
