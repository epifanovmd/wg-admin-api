import { z } from "zod";

/** `домен`, `домен:действие`, `домен:*`, `*`; сегменты — как имена очередей. */
const SCOPE_RE = /^(\*|[a-z][a-z0-9-]*(:[\w.\-/]+)*(:\*)?)$/;

export const CreateApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Название обязательно")
    .max(100, "Название не должно превышать 100 символов"),
  scopes: z
    .array(
      z
        .string()
        .max(100, "Scope не длиннее 100 символов")
        .regex(SCOPE_RE, "Scope: домен:действие, домен:* или *"),
    )
    .min(1, "Нужен хотя бы один scope")
    .max(50, "Не больше 50 scope"),
  expiresAt: z.coerce
    .date({ message: "Некорректная дата" })
    .refine(date => date.getTime() > Date.now(), "Дата должна быть в будущем")
    .optional(),
});
