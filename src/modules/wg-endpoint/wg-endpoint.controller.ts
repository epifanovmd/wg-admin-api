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
  ICreateWgEndpointBody,
  IUpdateWgEndpointBody,
  WgEndpointDto,
  WgEndpointOptionDto,
} from "./dto";
import { CreateWgEndpointSchema, UpdateWgEndpointSchema } from "./validation";
import { WgEndpointService } from "./wg-endpoint.service";

@Injectable()
@Tags("WgEndpoint")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/endpoints")
export class WgEndpointController extends Controller {
  constructor(
    @inject(WgEndpointService) private readonly _service: WgEndpointService,
  ) {
    super();
  }

  /**
   * Создать точку подключения — стабильный адрес для клиентских конфигов
   * (напрямую или через релей-ноду).
   * @summary Создание точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:manage"])
  @ValidateBody(CreateWgEndpointSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgEndpoint(
    @Body() body: ICreateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    return this._service.create(body);
  }

  /**
   * Точки подключения, новые первыми.
   * @summary Список точек подключения
   */
  @Security("jwt", ["permission:wg:endpoint:view"])
  @Get()
  listWgEndpoints(
    @Query() query?: string,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgEndpointDto>> {
    return this._service.list(query, normalizePagination(offset, limit));
  }

  /**
   * Краткий список для выпадающих списков.
   * @summary Точки подключения (options)
   */
  @Security("jwt", ["permission:wg:endpoint:view"])
  @Get("options")
  wgEndpointOptions(): Promise<WgEndpointOptionDto[]> {
    return this._service.options();
  }

  /**
   * Точка подключения по id.
   * @summary Точка подключения
   */
  @Security("jwt", ["permission:wg:endpoint:view"])
  @Get("{id}")
  getWgEndpoint(@Path() id: UUID): Promise<WgEndpointDto> {
    return this._service.get(id);
  }

  /**
   * Изменить точку подключения; смена хоста/релея применяется к нодам
   * автоматически, клиентские конфиги перевыпускать не нужно.
   * @summary Изменение точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:manage"])
  @ValidateBody(UpdateWgEndpointSchema)
  @Patch("{id}")
  updateWgEndpoint(
    @Path() id: UUID,
    @Body() body: IUpdateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    return this._service.update(id, body);
  }

  /**
   * Удалить точку подключения; используемая интерфейсами — 409.
   * @summary Удаление точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:manage"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgEndpoint(@Path() id: UUID): Promise<void> {
    await this._service.delete(id);
  }
}
