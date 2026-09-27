import { z } from "zod";

export const VerifyEmailSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Код должен состоять из 6 цифр"),
});
