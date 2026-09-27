import { Context } from "koa";

import { ForbiddenException } from "../http";
import { IGuard } from "./types";

/**
 * Разрешает доступ только с указанных IP-адресов (точное совпадение, без
 * CIDR). IP клиента — `ctx.ip`: за доверенным прокси (`TRUST_PROXY=true`)
 * Koa сам берёт его из `X-Forwarded-For`, без прокси заголовок игнорируется.
 *
 * @example
 * @UseGuards(IpWhitelistGuard(['127.0.0.1', '::1']))
 * @Get('/admin/internal')
 */
export const IpWhitelistGuard = (allowedIps: string[]) =>
  class implements IGuard {
    process(ctx: Context): boolean {
      if (!allowedIps.includes(ctx.ip)) {
        throw new ForbiddenException(`Access denied for IP: ${ctx.ip}`);
      }

      return true;
    }
  };
