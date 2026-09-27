import { z } from "zod";

import { twoFactorPassword } from "./two-factor-password";

export const Verify2FASchema = z.object({
  twoFactorToken: z
    .string()
    .min(1, "Токен обязателен")
    .max(2000, "Токен слишком длинный"),
  password: twoFactorPassword,
});
