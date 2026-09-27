import { z } from "zod";

import { wgHostSchema, wgPortSchema } from "../../wg-node";

const sshAccess = {
  host: wgHostSchema,
  port: wgPortSchema.optional(),
  username: z
    .string()
    .trim()
    .regex(/^[a-z_][a-z0-9_-]{0,31}$/i, "Некорректное имя пользователя SSH")
    .optional(),
  privateKey: z.string().max(16_000).optional(),
  password: z.string().max(256).optional(),
};

const requireSecret = {
  message: "Нужен SSH-ключ или пароль",
  path: ["privateKey"],
};

export const ProvisionWgNodeSchema = z
  .object({
    ...sshAccess,
    backendUrl: z.url("Ожидается URL бэкенда").max(500).optional(),
  })
  .refine(body => Boolean(body.privateKey || body.password), requireSecret);

export const UninstallWgNodeSchema = z
  .object(sshAccess)
  .refine(body => Boolean(body.privateKey || body.password), requireSecret);
