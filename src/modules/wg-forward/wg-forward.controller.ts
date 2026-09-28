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
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto, IPaginatedDto } from "../../core";
import { Injectable, normalizePagination, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import {
  ICreateWgForwardBody,
  IUpdateWgForwardBody,
  WgForwardDto,
} from "./dto";
import { CreateWgForwardSchema, UpdateWgForwardSchema } from "./validation";
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
   * адрес), путь и режим маршрута.
   * @summary Создание проброса
   */
  @Security("jwt", ["permission:wg:forward:create"])
  @ValidateBody(CreateWgForwardSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgForward(@Body() body: ICreateWgForwardBody): Promise<WgForwardDto> {
    return this._service.create(body);
  }

  /**
   * Пробросы с активным маршрутом по отчётам агентов.
   * @summary Список пробросов
   */
  @Security("jwt", ["permission:wg:forward:view"])
  @Get()
  listWgForwards(
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgForwardDto>> {
    return this._service.list(normalizePagination(offset, limit));
  }

  /**
   * @summary Проброс
   */
  @Security("jwt", ["permission:wg:forward:view"])
  @Get("{id}")
  getWgForward(@Path() id: UUID): Promise<WgForwardDto> {
    return this._service.get(id);
  }

  /**
   * Изменить проброс; в том числе переключить маршрут (auto / tunnel /
   * direct) — агент релея применит сразу.
   * @summary Изменение проброса
   */
  @Security("jwt", ["permission:wg:forward:update"])
  @ValidateBody(UpdateWgForwardSchema)
  @Patch("{id}")
  updateWgForward(
    @Path() id: UUID,
    @Body() body: IUpdateWgForwardBody,
  ): Promise<WgForwardDto> {
    return this._service.update(id, body);
  }

  /**
   * @summary Удаление проброса
   */
  @Security("jwt", ["permission:wg:forward:delete"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgForward(@Path() id: UUID): Promise<void> {
    await this._service.delete(id);
  }
}
