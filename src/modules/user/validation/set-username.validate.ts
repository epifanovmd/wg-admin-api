import { z } from "zod";

export const SetUsernameSchema = z.object({
  username: z
    .string()
    .regex(/^[a-z0-9_]{5,32}$/, "Username: 5-32 символа, a-z, 0-9, _")
    .transform(v => v.toLowerCase()),
});
