import { z } from "zod";

export const SetPrivilegesSchema = z.object({
  roles: z
    .array(z.string().min(1, "Название роли не может быть пустым"))
    .min(1, "Необходимо указать хотя бы одну роль"),
  permissions: z
    .array(z.string().min(1, "Название разрешения не может быть пустым"))
    .default([]),
});
