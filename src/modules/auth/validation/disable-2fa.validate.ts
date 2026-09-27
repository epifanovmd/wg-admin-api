import { z } from "zod";

import { currentPassword, twoFactorPassword } from "./two-factor-password";

export const Disable2FASchema = z.object({
  currentPassword,
  password: twoFactorPassword,
});
