import { Context } from "koa";

import { verifyToken } from "../auth";
import { ForbiddenException, UnauthorizedException } from "../http";
import { IGuard } from "./types";

/**
 * Требует подтверждённого email у пользователя.
 * Читает claim emailVerified из JWT без обращения к БД.
 * Должен использоваться вместе с @Security('jwt').
 *
 * @example
 * @Security('jwt')
 * @UseGuards(RequireVerifiedEmailGuard)
 * @Post('/send-message')
 */
export class RequireVerifiedEmailGuard implements IGuard {
  async process(ctx: Context): Promise<boolean> {
    const token = ctx.headers.authorization?.split(" ")[1];

    if (!token) {
      throw new UnauthorizedException();
    }

    const { emailVerified } = await verifyToken(token);

    if (!emailVerified) {
      throw new ForbiddenException("Email verification required.");
    }

    return true;
  }
}
