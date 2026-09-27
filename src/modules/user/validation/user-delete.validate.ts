import { z } from "zod";

export const DeleteMyUserSchema = z.object({
  password: z
    .string()
    .min(1, "Укажите пароль")
    .max(100, "Пароль не должен превышать 100 символов"),
});
