import { Context, Next } from "koa";

import { NotFoundException } from "../core/http";

export const notFoundMiddleware = (ctx: Context, _next: Next) => {
  if (ctx.status === 404) {
    throw new NotFoundException();
  }
};
