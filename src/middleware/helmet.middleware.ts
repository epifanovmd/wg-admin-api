import { Context, Next } from "koa";
import helmet from "koa-helmet";

/** Документация API: Swagger UI грузит ассеты с cdnjs и стартует inline-скриптом. */
const DOCS_PREFIX = "/api-docs";
const SWAGGER_CDN = "https://cdnjs.cloudflare.com";

/**
 * JSON API: страниц нет — запрещаем всё, что может исполнить или встроить
 * ответ. CORP `cross-origin`: файлы API показывает фронтенд с другого origin.
 */
const apiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

/**
 * Swagger UI: «Try it out» ходит на серверы из спецификации, поэтому connect-src
 * шире. Без `upgrade-insecure-requests` — иначе по http браузер переписывает
 * загрузку спецификации и запросы на https, которого у сервера нет.
 */
const docsHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'", SWAGGER_CDN],
      styleSrc: ["'self'", "'unsafe-inline'", SWAGGER_CDN],
      imgSrc: ["'self'", "data:", SWAGGER_CDN],
      connectSrc: ["'self'", "http:", "https:"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
});

/** Заголовки безопасности: строгие для API, мягче — для страницы документации. */
export const helmetMiddleware = (ctx: Context, next: Next) =>
  ctx.path.startsWith(DOCS_PREFIX)
    ? docsHelmet(ctx, next)
    : apiHelmet(ctx, next);
