import { Context } from "koa";

import { ForbiddenException } from "../http";
import { IGuard } from "./types";

/**
 * Требует HTTPS. `ctx.secure` за доверенным прокси (`TRUST_PROXY=true`)
 * учитывает `X-Forwarded-Proto`; без прокси заголовок не принимается.
 *
 * @example
 * @UseGuards(RequireHttpsGuard)
 * @Get('/secure-endpoint')
 */
export class RequireHttpsGuard implements IGuard {
  process(ctx: Context): boolean {
    if (!ctx.secure) {
      throw new ForbiddenException("HTTPS required.");
    }

    return true;
  }
}
