import { Context } from "koa";
import { Middlewares } from "tsoa";

import { IGuard } from "../guards";

type GuardType = (new () => IGuard) | IGuard;

export const UseGuards = (...guards: GuardType[]): MethodDecorator => {
  return Middlewares(
    ...guards.map(guard => async (ctx: Context, next: () => Promise<void>) => {
      const instance =
        typeof guard === "function" ? new (guard as new () => IGuard)() : guard;

      if (await instance.process(ctx)) {
        await next();
      }
    }),
  );
};
