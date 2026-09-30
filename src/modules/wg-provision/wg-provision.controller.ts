import { inject } from "inversify";
import {
  Body,
  Controller,
  Path,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IProvisionWgNodeBody,
  IUninstallWgNodeBody,
  IWgProvisionStartedDto,
} from "./dto";
import { ProvisionWgNodeSchema, UninstallWgNodeSchema } from "./validation";
import { WgProvisionService } from "./wg-provision.service";

@Injectable()
@Tags("WgProvision")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/nodes")
export class WgProvisionController extends Controller {
  constructor(
    @inject(WgProvisionService)
    private readonly _service: WgProvisionService,
  ) {
    super();
  }

  /**
   * Установить агента и WireGuard на VPS по SSH: docker, модули ядра,
   * ip_forward, контейнер агента со свежим ключом. Прогресс — в задаче
   * (`jobId`): комната `job` по сокету. SSH-данные используются один раз
   * и в открытом виде не сохраняются.
   * @summary Установка агента на VPS
   */
  @Security("jwt", ["permission:wg:node:provision:own"])
  @ValidateBody(ProvisionWgNodeSchema)
  @SuccessResponse(202, "Accepted")
  @Post("{id}/provision")
  provisionWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IProvisionWgNodeBody,
  ): Promise<IWgProvisionStartedDto> {
    this.setStatus(202);

    return this._service.provision(getContextUser(req), id, body);
  }

  /**
   * Удалить агента с VPS: агент откатывает свои интерфейсы, туннели и
   * пробросы, контейнер и конфигурация удаляются, ключ отзывается. Ход — в
   * задаче (комната ноды).
   * @summary Удаление агента с ноды
   */
  @Security("jwt", ["permission:wg:node:provision:own"])
  @ValidateBody(UninstallWgNodeSchema)
  @SuccessResponse(202, "Accepted")
  @Post("{id}/uninstall")
  uninstallWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUninstallWgNodeBody,
  ): Promise<IWgProvisionStartedDto> {
    this.setStatus(202);

    return this._service.uninstall(getContextUser(req), id, body);
  }
}
