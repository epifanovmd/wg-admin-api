import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Produces,
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
  IAssignWgPeerBody,
  ICreateWgPeerBody,
  IUpdateWgPeerBody,
  IWgPeerQrDto,
  WgPeerDto,
  WgPeerOptionDto,
} from "./dto";
import {
  AssignWgPeerSchema,
  CreateWgPeerSchema,
  UpdateWgPeerSchema,
} from "./validation";
import { WgPeerService } from "./wg-peer.service";

@Injectable()
@Tags("WgPeer")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/peers")
export class WgPeerController extends Controller {
  constructor(@inject(WgPeerService) private readonly _service: WgPeerService) {
    super();
  }

  /**
   * Создать пира: ключи и IP выделяются автоматически; `publicKey` — импорт
   * существующего клиента (его приватный ключ не хранится).
   * @summary Создание пира
   */
  @Security("jwt", ["permission:wg:peer:create"])
  @ValidateBody(CreateWgPeerSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgPeer(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgPeerBody,
  ): Promise<WgPeerDto> {
    return this._service.create(getContextUser(req), body);
  }

  /**
   * Пиры с фильтрами. С правом `wg:peer:view:own` — только свои пиры
   * (держатель или создатель).
   * @param mine Только свои пиры (держатель или создатель) при любой области прав
   * @summary Список пиров
   */
  @Security("jwt", ["permission:wg:peer:view:own"])
  @Get()
  listWgPeers(
    @Request() req: KoaRequest,
    @Query() interfaceId?: UUID,
    @Query() nodeId?: UUID,
    @Query() userId?: UUID,
    @Query() enabled?: boolean,
    @Query() online?: boolean,
    @Query() query?: string,
    @Query() mine?: boolean,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgPeerDto>> {
    return this._service.list(
      getContextUser(req),
      { interfaceId, nodeId, userId, enabled, online, query, mine },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список пиров для выпадающих списков (в рамках прав).
   * @param mine Только свои пиры (держатель или создатель) при любой области прав
   * @summary Пиры (options)
   */
  @Security("jwt", ["permission:wg:peer:view:own"])
  @Get("options")
  wgPeerOptions(
    @Request() req: KoaRequest,
    @Query() mine?: boolean,
  ): Promise<WgPeerOptionDto[]> {
    return this._service.options(getContextUser(req), mine);
  }

  /**
   * Пир по id; чужой без права на все пиры — 404.
   * @summary Пир
   */
  @Security("jwt", ["permission:wg:peer:view:own"])
  @Get("{id}")
  getWgPeer(@Request() req: KoaRequest, @Path() id: UUID): Promise<WgPeerDto> {
    return this._service.get(getContextUser(req), id);
  }

  /**
   * Изменить пира: переданные поля заменяются.
   * @summary Изменение пира
   */
  @Security("jwt", ["permission:wg:peer:update:own"])
  @ValidateBody(UpdateWgPeerSchema)
  @Patch("{id}")
  updateWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgPeerBody,
  ): Promise<WgPeerDto> {
    return this._service.update(getContextUser(req), id, body);
  }

  /**
   * Удалить пира; агент снимет его с интерфейса.
   * @summary Удаление пира
   */
  @Security("jwt", ["permission:wg:peer:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._service.delete(getContextUser(req), id);
  }

  /**
   * Включить пира.
   * @summary Включение пира
   */
  @Security("jwt", ["permission:wg:peer:toggle:own"])
  @Post("{id}/enable")
  enableWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgPeerDto> {
    return this._service.setEnabled(getContextUser(req), id, true);
  }

  /**
   * Выключить пира.
   * @summary Выключение пира
   */
  @Security("jwt", ["permission:wg:peer:toggle:own"])
  @Post("{id}/disable")
  disableWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgPeerDto> {
    return this._service.setEnabled(getContextUser(req), id, false);
  }

  /**
   * Создать новый preshared-ключ; клиенту нужен новый конфиг.
   * @summary Ротация PSK
   */
  @Security("jwt", ["permission:wg:peer:psk:own"])
  @Post("{id}/psk/rotate")
  rotateWgPeerPsk(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgPeerDto> {
    return this._service.rotatePresharedKey(getContextUser(req), id);
  }

  /**
   * Убрать preshared-ключ; клиенту нужен новый конфиг.
   * @summary Удаление PSK
   */
  @Security("jwt", ["permission:wg:peer:psk:own"])
  @Delete("{id}/psk")
  removeWgPeerPsk(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgPeerDto> {
    return this._service.removePresharedKey(getContextUser(req), id);
  }

  /**
   * Назначить пира пользователю (он увидит его в «Моих пирах»).
   * @summary Назначение пира
   */
  @Security("jwt", ["permission:wg:peer:assign:own"])
  @ValidateBody(AssignWgPeerSchema)
  @Post("{id}/assign")
  assignWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgPeerBody,
  ): Promise<WgPeerDto> {
    return this._service.assign(getContextUser(req), id, body);
  }

  /**
   * Отвязать пира от пользователя.
   * @summary Отвязка пира
   */
  @Security("jwt", ["permission:wg:peer:assign:own"])
  @Post("{id}/revoke")
  revokeWgPeer(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgPeerDto> {
    return this._service.revoke(getContextUser(req), id);
  }

  /**
   * Клиентский конфиг `.conf` (attachment).
   * @summary Конфиг пира
   */
  @Security("jwt", ["permission:wg:peer:view:own"])
  @Produces("text/plain")
  @Get("{id}/config")
  async wgPeerConfig(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<string> {
    const { fileName, content } = await this._service.buildConfig(
      getContextUser(req),
      id,
    );

    this.setHeader("Content-Type", "text/plain; charset=utf-8");
    this.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return content;
  }

  /**
   * QR-код клиентского конфига (PNG data-URL).
   * @summary QR пира
   */
  @Security("jwt", ["permission:wg:peer:view:own"])
  @Get("{id}/qr")
  wgPeerQr(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<IWgPeerQrDto> {
    return this._service.buildQr(getContextUser(req), id);
  }
}
