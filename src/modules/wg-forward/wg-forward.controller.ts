import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto, IPaginatedDto } from "../../core";
import {
  getContextUser,
  Injectable,
  normalizePagination,
  ValidateBody,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IAssignWgForwardBody,
  ICreateWgForwardBody,
  IUpdateWgForwardBody,
  WgForwardDto,
} from "./dto";
import {
  AssignWgForwardSchema,
  CreateWgForwardSchema,
  UpdateWgForwardSchema,
} from "./validation";
import { WgForwardService } from "./wg-forward.service";

/**
 * Пробросы портов на релее до внешних сервисов (WireGuard-сервер, прокси):
 * напрямую или через IPIP-туннель с аварийным переходом на прямой путь.
 */
@Injectable()
@Tags("WgForward")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/forwards")
export class WgForwardController extends Controller {
  constructor(
    @inject(WgForwardService) private readonly _service: WgForwardService,
  ) {
    super();
  }

  /**
   * Создать проброс: релей, протокол и порт, цель (нода с агентом или
   * адрес), путь и режим маршрута. Релей и нода-цель должны быть видны
   * автору; создатель — автор запроса, владелец, отличный от себя, — только с
   * правом `wg:forward:assign`.
   * @summary Создание проброса
   */
  @Security("jwt", ["permission:wg:forward:create"])
  @ValidateBody(CreateWgForwardSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgForward(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgForwardBody,
  ): Promise<WgForwardDto> {
    return this._service.create(getContextUser(req), body);
  }

  /**
   * Пробросы с активным маршрутом по отчётам агентов. С правом
   * `wg:forward:view:own` — только свои (владелец или создатель).
   * @summary Список пробросов
   */
  @Security("jwt", ["permission:wg:forward:view:own"])
  @Get()
  listWgForwards(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgForwardDto>> {
    return this._service.list(
      getContextUser(req),
      normalizePagination(offset, limit),
    );
  }

  /**
   * Проброс по id; чужой без права на все пробросы — 404.
   * @summary Проброс
   */
  @Security("jwt", ["permission:wg:forward:view:own"])
  @Get("{id}")
  getWgForward(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgForwardDto> {
    return this._service.get(getContextUser(req), id);
  }

  /**
   * Изменить проброс; в том числе переключить маршрут (auto / tunnel /
   * direct) — агент релея применит сразу. Новая нода-цель должна быть видна
   * автору.
   * @summary Изменение проброса
   */
  @Security("jwt", ["permission:wg:forward:update:own"])
  @ValidateBody(UpdateWgForwardSchema)
  @Patch("{id}")
  updateWgForward(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgForwardBody,
  ): Promise<WgForwardDto> {
    return this._service.update(getContextUser(req), id, body);
  }

  /**
   * @summary Удаление проброса
   */
  @Security("jwt", ["permission:wg:forward:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgForward(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._service.delete(getContextUser(req), id);
  }

  /**
   * Назначить владельца проброса (он станет для него своим).
   * @summary Назначение владельца проброса
   */
  @Security("jwt", ["permission:wg:forward:assign:own"])
  @ValidateBody(AssignWgForwardSchema)
  @Post("{id}/assign")
  assignWgForward(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgForwardBody,
  ): Promise<WgForwardDto> {
    return this._service.assign(getContextUser(req), id, body);
  }

  /**
   * Снять владельца проброса.
   * @summary Снятие владельца проброса
   */
  @Security("jwt", ["permission:wg:forward:assign:own"])
  @Post("{id}/revoke")
  revokeWgForward(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgForwardDto> {
    return this._service.revoke(getContextUser(req), id);
  }
}
