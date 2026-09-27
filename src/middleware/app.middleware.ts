import Koa from "koa";

import { bodyParserMiddleware } from "./body-parser.middleware";
import { corsMiddleware } from "./cors.middleware";
import { errorMiddleware } from "./error.middleware";
import { helmetMiddleware } from "./helmet.middleware";
import { rateLimitMiddleware } from "./rate-limit.middleware";
import { requestIdMiddleware } from "./request-id.middleware";
import { requestLoggerMiddleware } from "./request-logger.middleware";

/**
 * Сквозные middleware для всех маршрутов, включая служебные: идентификатор
 * запроса, лог доступа, единый формат ошибок.
 */
export const RegisterBaseMiddlewares = (app: Koa) => {
  app
    .use(requestIdMiddleware)
    .use(requestLoggerMiddleware)
    .use(errorMiddleware);
};

/**
 * Middleware бизнес-маршрутов: заголовки безопасности, CORS, лимит запросов,
 * разбор тела. Служебные маршруты (`/ping`, `/ready`) регистрируются раньше
 * и под лимит не попадают.
 */
export const RegisterAppMiddlewares = (app: Koa) => {
  app
    .use(helmetMiddleware)
    .use(corsMiddleware)
    .use(rateLimitMiddleware)
    .use(bodyParserMiddleware);
};
