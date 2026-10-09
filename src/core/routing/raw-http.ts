import type { IncomingMessage, ServerResponse } from "http";
import type { Middleware } from "koa";

/**
 * Обработчики HTTP со своим протоколом (канал агентов): получают запрос до
 * разбора тела, CORS и лимита запросов и отвечают сами. Модуль регистрирует
 * `{ provide: RAW_HTTP_HANDLER, useClass }`; App опрашивает их на ролях с
 * HTTP API. Такие пути в Swagger не попадают — документируются в README модуля.
 */
export const RAW_HTTP_HANDLER = Symbol("RawHttpHandler");

export interface IRawHttpHandler {
  /** Обслужить запрос целиком (тело читает сам); `false` — запрос не его. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

/**
 * Middleware опроса обработчиков: обслуженный запрос Koa больше не трогает.
 * Список берётся при каждом запросе — он заполняется после загрузки модулей.
 */
export const rawHttpMiddleware =
  (handlers: () => readonly IRawHttpHandler[]): Middleware =>
  async (ctx, next) => {
    for (const handler of handlers()) {
      if (await handler.handle(ctx.req, ctx.res)) {
        ctx.respond = false;

        return;
      }
    }

    await next();
  };
