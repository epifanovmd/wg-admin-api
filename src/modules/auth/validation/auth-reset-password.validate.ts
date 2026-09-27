import { z } from "zod";

import { accountPassword } from "./account-password";

export const RequestResetPasswordSchema = z.object({
  login: z
    .string()
    .min(1, "Логин не может быть пустым")
    .max(100, "Логин не должен превышать 100 символов"),
});

export const ResetPasswordSchema = z.object({
  token: z
    .string()
    .min(1, "Токен не может быть пустым")
    .max(200, "Токен слишком длинный"),
  password: accountPassword,
});
