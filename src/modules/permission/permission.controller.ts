import { Controller, Get, Response, Route, Security, Tags } from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { Injectable } from "../../core";
import { IPermissionCatalogDto } from "./permission.dto";
import { getPermissionCatalog } from "./permission.registry";

@Injectable()
@Tags("Permission")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/permissions")
export class PermissionController extends Controller {
  /**
   * Каталог прав по группам с подписями — для редакторов ролей и прав
   * пользователей. Первая группа — «Система» (полный доступ `*`).
   *
   * @summary Каталог прав
   */
  @Security("jwt")
  @Get()
  getPermissionCatalog(): IPermissionCatalogDto {
    return { groups: getPermissionCatalog() };
  }
}
