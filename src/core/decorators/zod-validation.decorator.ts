import { Context } from "koa";
import { Middlewares } from "tsoa";
import { z } from "zod";

import { ValidationException } from "../http";

/**
 * Фабрика для создания middleware валидации Zod
 */
const createZodValidationMiddleware = (
  schema: z.ZodSchema<any>,
  source: "body" | "query" | "params" = "body",
) => {
  return Middlewares(async (ctx: Context, next: () => Promise<any>) => {
    const data =
      source === "body"
        ? ctx.request.body
        : source === "query"
          ? ctx.query
          : ctx.params;

    const { error, data: _data } = await schema.safeParseAsync(data);

    if (error) {
      const errors = error.issues.reduce<Record<string, string>>(
        (acc, issue) => {
          const field = issue.path.join(".") || "_";

          acc[field] = issue.message;

          return acc;
        },
        {},
      );

      throw new ValidationException(errors);
    }

    if (source === "body") {
      ctx.request.body = _data;
    } else if (source === "query") {
      ctx.query = _data;
    } else if (source === "params") {
      ctx.params = _data;
    }

    return next();
  });
};

export const ValidateBody = (schema: z.ZodSchema<any>) =>
  createZodValidationMiddleware(schema, "body");

export const ValidateQuery = (schema: z.ZodSchema<any>) =>
  createZodValidationMiddleware(schema, "query");

export const ValidateParams = (schema: z.ZodSchema<any>) =>
  createZodValidationMiddleware(schema, "params");
