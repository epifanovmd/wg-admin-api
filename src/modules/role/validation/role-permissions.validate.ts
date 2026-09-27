import { z } from "zod";

export const SetRolePermissionsSchema = z.object({
  permissions: z
    .array(z.string().min(1, "Название разрешения не может быть пустым"))
    .default([]),
});
