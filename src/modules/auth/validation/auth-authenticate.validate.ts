import { z } from "zod";

export const AuthenticateSchema = z.object({
  code: z.string().min(1, "Code не может быть пустым"),
});
