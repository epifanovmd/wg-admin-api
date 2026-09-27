import { z } from "zod";

export const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Укажите текущий пароль")
      .max(100, "Пароль не должен превышать 100 символов"),
    newPassword: z
      .string()
      .min(8, "Пароль должен содержать минимум 8 символов")
      .max(100, "Пароль не должен превышать 100 символов"),
  })
  .refine(data => data.currentPassword !== data.newPassword, {
    message: "Новый пароль должен отличаться от текущего",
    path: ["newPassword"],
  });
