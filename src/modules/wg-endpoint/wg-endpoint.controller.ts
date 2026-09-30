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
  IAssignWgEndpointBody,
  ICreateWgEndpointBody,
  IUpdateWgEndpointBody,
  WgEndpointDto,
  WgEndpointOptionDto,
} from "./dto";
import {
  AssignWgEndpointSchema,
  CreateWgEndpointSchema,
  UpdateWgEndpointSchema,
} from "./validation";
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
   * (напрямую или через релей-ноду, видимую автору). Создатель — автор
   * запроса; владелец, отличный от себя, — только с правом
   * `wg:endpoint:assign`.
   * @summary Создание точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:create"])
  @ValidateBody(CreateWgEndpointSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgEndpoint(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    return this._service.create(getContextUser(req), body);
  }

  /**
   * Точки подключения, новые первыми. С правом `wg:endpoint:view:own` —
   * только свои (владелец или создатель).
   * @summary Список точек подключения
   */
  @Security("jwt", ["permission:wg:endpoint:view:own"])
  @Get()
  listWgEndpoints(
    @Request() req: KoaRequest,
    @Query() query?: string,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgEndpointDto>> {
    return this._service.list(
      getContextUser(req),
      query,
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список для выпадающих списков (в рамках прав).
   * @summary Точки подключения (options)
   */
  @Security("jwt", ["permission:wg:endpoint:view:own"])
  @Get("options")
  wgEndpointOptions(
    @Request() req: KoaRequest,
  ): Promise<WgEndpointOptionDto[]> {
    return this._service.options(getContextUser(req));
  }

  /**
   * Точка подключения по id; чужая без права на все точки — 404.
   * @summary Точка подключения
   */
  @Security("jwt", ["permission:wg:endpoint:view:own"])
  @Get("{id}")
  getWgEndpoint(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgEndpointDto> {
    return this._service.get(getContextUser(req), id);
  }

  /**
   * Изменить точку подключения; смена хоста/релея применяется к нодам
   * автоматически, клиентские конфиги перевыпускать не нужно. Новый релей
   * должен быть виден автору.
   * @summary Изменение точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:update:own"])
  @ValidateBody(UpdateWgEndpointSchema)
  @Patch("{id}")
  updateWgEndpoint(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgEndpointBody,
  ): Promise<WgEndpointDto> {
    return this._service.update(getContextUser(req), id, body);
  }

  /**
   * Удалить точку подключения; используемая интерфейсами — 409.
   * @summary Удаление точки подключения
   */
  @Security("jwt", ["permission:wg:endpoint:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgEndpoint(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._service.delete(getContextUser(req), id);
  }

  /**
   * Назначить владельца точки подключения (она станет для него своей).
   * @summary Назначение владельца точки
   */
  @Security("jwt", ["permission:wg:endpoint:assign:own"])
  @ValidateBody(AssignWgEndpointSchema)
  @Post("{id}/assign")
  assignWgEndpoint(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgEndpointBody,
  ): Promise<WgEndpointDto> {
    return this._service.assign(getContextUser(req), id, body);
  }

  /**
   * Снять владельца точки подключения.
   * @summary Снятие владельца точки
   */
  @Security("jwt", ["permission:wg:endpoint:assign:own"])
  @Post("{id}/revoke")
  revokeWgEndpoint(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgEndpointDto> {
    return this._service.revoke(getContextUser(req), id);
  }
}
