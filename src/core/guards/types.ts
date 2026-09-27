import { Context } from "koa";

export interface IGuard {
  process(ctx: Context): boolean | Promise<boolean>;
}
