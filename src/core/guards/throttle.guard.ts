import { Context } from "koa";

import { TooManyRequestsException } from "../http";
import { getThrottleStore, IThrottleStore } from "./throttle.store";
import { IGuard } from "./types";

let guardsCreated = 0;

/**
 * Ограничивает частоту запросов на конкретный маршрут по IP клиента.
 * Счётчики — в общем хранилище (`getThrottleStore`: Redis между репликами
 * или память процесса).
 *
 * @param limit    — максимальное число запросов за окно
 * @param windowMs — размер окна в миллисекундах
 * @param name     — имя счётчика; маршрут с таким же именем делит лимит.
 *                   По умолчанию — порядковый номер создания: одинаков на
 *                   всех репликах одной сборки, но лучше задавать явно.
 *
 * @example
 * @UseGuards(ThrottleGuard(5, 60_000, "auth:sign-in"))
 * @Post('/auth/sign-in')
 */
export const ThrottleGuard = (
  limit: number,
  windowMs: number,
  name?: string,
  store?: IThrottleStore,
) => {
  guardsCreated += 1;

  const prefix = `throttle:${name ?? `g${guardsCreated}:${limit}:${windowMs}`}`;

  return class implements IGuard {
    async process(ctx: Context): Promise<boolean> {
      const { count, resetAt } = await (store ?? getThrottleStore()).hit(
        `${prefix}:${ctx.ip}`,
        windowMs,
      );

      if (count > limit) {
        ctx.set(
          "Retry-After",
          String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
        );
        throw new TooManyRequestsException();
      }

      return true;
    }
  };
};
