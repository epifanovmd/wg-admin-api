import { z } from "zod";

import {
  AGENT_ID_PATTERN,
  AGENT_INSTALL_MODES,
  COMMAND_TYPE_PATTERN,
  WORKER_NAME_PATTERN,
} from "../agent.types";

export const PageQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentEventsQuerySchema = z.object({
  agentId: z.string().regex(AGENT_ID_PATTERN).optional(),
  worker: z.string().regex(WORKER_NAME_PATTERN).optional(),
  type: z.string().regex(COMMAND_TYPE_PATTERN).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentMetricsQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  until: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export const AgentLogsQuerySchema = z.object({
  worker: z.string().regex(WORKER_NAME_PATTERN).optional(),
  lines: z.coerce.number().int().min(1).max(5000).optional(),
});

export const AgentCommandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentCommandWaitQuerySchema = z.object({
  waitSeconds: z.coerce.number().int().min(0).max(120).optional(),
});

export const AgentUpdateBodySchema = z.object({
  version: z.string().min(1).max(64).optional(),
});

export const WorkerRestartBodySchema = z.object({
  force: z.boolean().optional(),
});

export const WorkerUpdateBodySchema = z.object({
  version: z.string().min(1).max(64).optional(),
  force: z.boolean().optional(),
});

export const WorkerCommandBodySchema = z.object({
  type: z.string().regex(COMMAND_TYPE_PATTERN),
  args: z.unknown().optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 3_600_000)
    .optional(),
  waitSeconds: z.number().int().min(0).max(120).optional(),
});

export const CreateEnrollmentTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  labels: z.record(z.string(), z.string().max(256)).optional(),
  maxUses: z.number().int().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
});

const shellValue = z
  .string()
  .min(1)
  .max(500)
  .refine(value => !/[\r\n]/.test(value), "Без перевода строки");

export const InstallCommandBodySchema = z
  .object({
    token: shellValue.optional(),
    tokenFile: shellValue.optional(),
    name: z.string().max(128).optional(),
    baseUrl: z.url("Адрес — URL").max(500).optional(),
    mode: z.enum(AGENT_INSTALL_MODES).optional(),
  })
  .refine(value => !!value.token !== !!value.tokenFile, {
    message: "Нужно ровно одно из token и tokenFile",
    path: ["token"],
  });

/** Выдача агента получателю: токен, `.env` с адресом и именем (архив и ссылка — с ним же). */
export const IssueAgentBodySchema = z.object({
  /** Имя агента (`AGENT_NAME`); нет — имя машины. */
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine(value => !/[\r\n]/.test(value), "Без перевода строки")
    .optional(),
  labels: z.record(z.string(), z.string().max(256)).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
  /** Срок токена, мин (по умолчанию сутки). */
  expiresInMinutes: z
    .number()
    .int()
    .min(5)
    .max(30 * 24 * 60)
    .optional(),
  baseUrl: z.url("Адрес — URL").max(500).optional(),
});

export const IssueAgentLinkBodySchema = IssueAgentBodySchema.extend({
  /** Срок ссылки, мин (по умолчанию сутки). */
  linkExpiresInMinutes: z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .optional(),
});
