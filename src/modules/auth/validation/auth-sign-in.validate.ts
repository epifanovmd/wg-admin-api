import { z } from "zod";

const password = z
  .string()
  .min(6, "Пароль должен содержать минимум 6 символов")
  .max(100, "Пароль не должен превышать 100 символов");

const login = z
  .string()
  .min(1, "Логин не может быть пустым")
  .max(100, "Логин не должен превышать 100 символов");

export const SignInSchema = z.object({
  login,
  password,
});
