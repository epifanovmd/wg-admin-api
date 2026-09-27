import { z } from "zod";

import { PAGINATION_MAX_LIMIT } from "../../../core";
import { EJobRunStatus } from "../jobs.types";

export const ListJobsQuerySchema = z
  .object({
    status: z
      .enum(EJobRunStatus, { message: "Недопустимый статус задачи" })
      .optional(),
    scopeType: z
      .string()
      .min(1)
      .max(50, "scopeType — до 50 символов")
      .optional(),
    scopeId: z.string().min(1).max(100, "scopeId — до 100 символов").optional(),
    limit: z.coerce
      .number()
      .int("limit должен быть целым числом")
      .min(1, "limit должен быть не меньше 1")
      .max(
        PAGINATION_MAX_LIMIT,
        `limit не должен превышать ${PAGINATION_MAX_LIMIT}`,
      )
      .optional(),
    offset: z.coerce
      .number()
      .int("offset должен быть целым числом")
      .min(0, "offset не может быть отрицательным")
      .optional(),
  })
  .refine(q => !q.scopeType === !q.scopeId, {
    message: "scopeType и scopeId передаются вместе",
    path: ["scopeId"],
  });
