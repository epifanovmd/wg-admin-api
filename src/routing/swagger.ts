import KoaRouter from "@koa/router";
import { koaSwagger } from "koa2-swagger-ui";

import type { IDocsServer } from "../core/http/docs-servers";
import swaggerDoc from "./swagger.json";

/** Спецификация отдаётся с `servers`, вычисленными на момент запроса. */
export const RegisterSwagger = (
  router: KoaRouter,
  url: string,
  getServers: (origin: string) => IDocsServer[],
) => {
  const specUrl = `${url}/swagger.json`;

  router.get(specUrl, context => {
    // ctx.origin в Koa 3 — заголовок Origin запроса, а не адрес сервера
    const origin = `${context.protocol}://${context.host}`;

    context.status = 200;
    context.body = { ...swaggerDoc, servers: getServers(origin) };
  });

  router.get(
    url,
    koaSwagger({
      routePrefix: false,
      swaggerOptions: {
        showRequestHeaders: true,
        url: specUrl,
        jsonEditor: true,
      },
    }),
  );
};
