import { z } from "zod";

import { wgHostSchema, wgPortSchema } from "../../wg-node";
import {
  WG_SOCKS_NAME_MAX,
  WG_SOCKS_PASSWORD_MAX,
  WG_SOCKS_USERNAME_MAX,
} from "../wg-socks.types";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(
    WG_SOCKS_NAME_MAX,
    `Название — не длиннее ${WG_SOCKS_NAME_MAX} символов`,
  );
const description = z.string().trim().max(2000).nullable().optional();
const username = z
  .string()
  .trim()
  .min(1, "Имя пользователя не может быть пустым")
  .max(WG_SOCKS_USERNAME_MAX)
  .regex(/^[\w.@-]+$/, "Латиница, цифры, . _ @ -");
const clientHost = wgHostSchema.nullable().optional();
const clientPort = wgPortSchema.nullable().optional();
const password = z
  .string()
  .min(8, "Пароль — не короче 8 символов")
  .max(WG_SOCKS_PASSWORD_MAX);

export const CreateWgSocksSchema = z.object({
  name,
  description,
  nodeId: z.uuid(),
  listenPort: wgPortSchema,
  clientHost,
  clientPort,
  serverName: wgHostSchema.optional(),
  ownerId: z.uuid().nullable().optional(),
});

export const UpdateWgSocksSchema = z
  .object({
    name: name.optional(),
    description,
    listenPort: wgPortSchema.optional(),
    clientHost,
    clientPort,
    enabled: z.boolean().optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });

export const CreateWgSocksUserSchema = z.object({
  username,
  password: password.optional(),
});

export const UpdateWgSocksUserSchema = z
  .object({ enabled: z.boolean().optional(), password: password.optional() })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });

export const CreateWgSocksClientSchema = z.object({ name });

export const AssignWgSocksSchema = z.object({
  userId: z.uuid(),
});
