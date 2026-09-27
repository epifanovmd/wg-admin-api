import { z } from "zod";

import { currentPassword, newTwoFactorPassword } from "./two-factor-password";

export const Enable2FASchema = z.object({
  currentPassword,
  password: newTwoFactorPassword,
  hint: z
    .string()
    .max(100, "Подсказка не должна превышать 100 символов")
    .optional(),
});
