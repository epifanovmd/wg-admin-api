import { inject } from "inversify";
import { Controller, Get, Response, Route, Security, Tags } from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { Injectable } from "../../core";
import { IAppVersionDto } from "./app-info.dto";
import { AppInfoService } from "./app-info.service";

@Injectable()
@Tags("AppInfo")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/app")
export class AppInfoController extends Controller {
  constructor(
    @inject(AppInfoService) private readonly _appInfo: AppInfoService,
  ) {
    super();
  }

  /**
   * Версия запущенного бэкенда (тег или SHA сборки, коммит, время сборки и
   * запуска процесса) и агента, которого он раздаёт, — для подписи версий в
   * админке.
   *
   * @summary Версия бэкенда
   */
  @Security("jwt")
  @Get("version")
  getAppVersion(): Promise<IAppVersionDto> {
    return this._appInfo.version();
  }
}
