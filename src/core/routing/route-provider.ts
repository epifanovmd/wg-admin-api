import KoaRouter from "@koa/router";

/**
 * Роуты вне tsoa: потоковая раздача файлов, всё, что не описывается
 * контроллером. Модуль регистрирует провайдер под этим токеном, App
 * собирает их после tsoa-роутов. Такие пути в Swagger не попадают —
 * документируются в README модуля.
 */
export const ROUTE_PROVIDER = Symbol("RouteProvider");

export interface IRouteProvider {
  register(router: KoaRouter): void;
}
