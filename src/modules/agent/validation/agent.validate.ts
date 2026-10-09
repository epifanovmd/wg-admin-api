import { z } from "zod";

import {
  AGENT_FETCH_BODY_MAX,
  AGENT_FETCH_TIMEOUT,
  AGENT_ID_PATTERN,
  EVENT_TYPE_PATTERN,
  WORKER_NAME_PATTERN,
} from "../agent.types";

/** Значение настройки — не больше 4 МБ JSON (предел агента). */
const CONFIG_VALUE_MAX = 4 * 1024 * 1024;

const agentId = z.string().regex(AGENT_ID_PATTERN, "Некорректный id агента");

const workerName = z
  .string()
  .regex(
    WORKER_NAME_PATTERN,
    "Имя воркера: строчная латиница, цифры и «-», начало — буква, до 32 символов",
  );

const labels = z
  .record(
    z.string().min(1).max(256, "Ключ метки не длиннее 256 символов"),
    z.string().max(256, "Значение метки не длиннее 256 символов"),
  )
  .refine(value => Object.keys(value).length <= 64, "Не больше 64 меток");

const pageQuery = {
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

export const PageQuerySchema = z.object(pageQuery);

export const AgentAlertsQuerySchema = z.object({
  agentId: agentId.optional(),
});

export const AgentEventsQuerySchema = z.object({
  agentId: agentId.optional(),
  worker: workerName.optional(),
  type: z
    .string()
    .regex(EVENT_TYPE_PATTERN, "Тип события: строчная латиница, цифры, «._-»")
    .optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentLogsQuerySchema = z.object({
  worker: workerName.optional(),
  lines: z.coerce.number().int().min(1).max(5000).optional(),
});

export const AgentConfigsQuerySchema = z.object({
  worker: workerName.optional(),
});

export const AgentWorkerActionSchema = z.object({
  force: z.boolean().optional(),
});

export const SetAgentConfigSchema = z.object({
  data: z
    .unknown()
    .refine(value => value !== undefined, "Нужно значение data")
    .refine(
      value => JSON.stringify(value ?? null).length <= CONFIG_VALUE_MAX,
      "Значение настройки — не больше 4 МБ",
    ),
});

export const AgentFetchSchema = z
  .object({
    method: z
      .string()
      .regex(/^[A-Z]{1,16}$/, "Метод — заглавными латинскими буквами")
      .optional(),
    path: z
      .string()
      .min(1)
      .max(2048, "Путь не длиннее 2048 символов")
      .regex(/^\/\S*$/, "Путь — от «/», без пробелов"),
    headers: z
      .record(
        z.string().min(1).max(256),
        z.string().max(8192, "Значение заголовка не длиннее 8 КБ"),
      )
      .refine(
        value => Object.keys(value).length <= 64,
        "Не больше 64 заголовков",
      )
      .optional(),
    body: z
      .string()
      .max(
        Math.ceil((AGENT_FETCH_BODY_MAX * 4) / 3) + 4,
        "Тело запроса — не больше 4 МБ",
      )
      .optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(AGENT_FETCH_TIMEOUT.maxMs, "Срок — не больше 10 минут")
      .optional(),
  })
  .refine(
    value =>
      value.body === undefined ||
      !["GET", "HEAD"].includes(value.method ?? "GET"),
    { message: "У GET и HEAD нет тела", path: ["body"] },
  )
  .refine(
    value =>
      value.encoding !== "base64" ||
      value.body === undefined ||
      /^[A-Za-z0-9+/]*={0,2}$/.test(value.body),
    { message: "Тело — не base64", path: ["body"] },
  );

export const CreateAgentEnrollmentTokenSchema = z.object({
  name: z.string().trim().min(1).max(100, "Название не длиннее 100 символов"),
  labels: labels.optional(),
  maxUses: z.number().int().min(1).max(100_000).optional(),
  expiresAt: z.coerce
    .date()
    .refine(date => date.getTime() > Date.now(), "Срок — в будущем")
    .optional(),
});

const shellValue = z
  .string()
  .min(1)
  .max(500)
  .refine(value => !/[\r\n]/.test(value), "Без перевода строки");

export const CreateAgentInstallCommandSchema = z
  .object({
    token: shellValue.optional(),
    tokenFile: shellValue.optional(),
    baseUrl: z.url("Адрес — URL").max(500).optional(),
    name: z.string().min(1).max(128).optional(),
    user: shellValue.optional(),
    config: shellValue.optional(),
    privileged: z.boolean().optional(),
    killMode: z.enum(["process", "mixed"]).optional(),
    packages: z.array(shellValue).max(50).optional(),
    packagesByManager: z
      .object({
        apt: z.array(shellValue).max(50).optional(),
        dnf: z.array(shellValue).max(50).optional(),
        yum: z.array(shellValue).max(50).optional(),
        apk: z.array(shellValue).max(50).optional(),
        zypper: z.array(shellValue).max(50).optional(),
      })
      .strict()
      .optional(),
    sysctl: z.record(shellValue, shellValue).optional(),
    rwPaths: z.array(shellValue).max(20).optional(),
    caFile: shellValue.optional(),
    workers: z.array(workerName).max(20).optional(),
    stopTimeout: shellValue.optional(),
    releases: z.url("Адрес — URL").max(500).optional(),
  })
  .refine(value => !!value.token !== !!value.tokenFile, {
    message: "Нужно ровно одно из token и tokenFile",
    path: ["token"],
  });
