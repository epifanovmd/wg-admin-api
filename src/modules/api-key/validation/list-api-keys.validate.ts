import { z } from "zod";

import { PAGINATION_MAX_LIMIT } from "../../../core";

export const ListApiKeysQuerySchema = z.object({
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
});
