import { z } from "zod";

export const ConfirmEmailChangeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Код должен состоять из 6 цифр"),
});
