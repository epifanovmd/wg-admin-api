import { z } from "zod";

import {
  WG_AGENT_LOGS_MAX_LINES,
  WG_NODE_DESCRIPTION_MAX,
  WG_NODE_NAME_MAX,
} from "../wg-node.types";
import { wgHostSchema } from "./wg-shared.validate";

const name = z
  .string()
  .trim()
  .min(1, "Название не может быть пустым")
  .max(WG_NODE_NAME_MAX, `Название — не длиннее ${WG_NODE_NAME_MAX} символов`);

const description = z
  .string()
  .trim()
  .max(
    WG_NODE_DESCRIPTION_MAX,
    `Описание — не длиннее ${WG_NODE_DESCRIPTION_MAX} символов`,
  )
  .nullable();

export const CreateWgNodeSchema = z.object({
  name,
  description: description.optional(),
  publicHost: wgHostSchema.nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});

export const UpdateWgNodeSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    publicHost: wgHostSchema.nullable().optional(),
  })
  .refine(body => Object.values(body).some(v => v !== undefined), {
    message: "Нужно хотя бы одно поле",
  });

export const AssignWgNodeSchema = z.object({
  userId: z.uuid(),
});

/** Токен установки: от 10 минут до 30 дней. */
export const CreateWgNodeInstallCommandSchema = z.object({
  expiresInMinutes: z
    .number()
    .int()
    .min(10, "Срок токена — не меньше 10 минут")
    .max(30 * 24 * 60, "Срок токена — не больше 30 дней")
    .optional(),
});

export const BindWgNodeAgentSchema = z.object({
  agentId: z.string().regex(/^[0-9a-f]{32}$/, "Некорректный id агента"),
});

export const UpdateWgNodeWorkerSchema = z.object({
  force: z.boolean().optional(),
});

export const WgNodeLogsQuerySchema = z.object({
  lines: z.coerce.number().int().min(1).max(WG_AGENT_LOGS_MAX_LINES).optional(),
  worker: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/, "Некорректное имя воркера")
    .optional(),
});
