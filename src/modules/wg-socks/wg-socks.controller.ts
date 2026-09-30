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

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IAssignWgSocksBody,
  ICreateWgSocksBody,
  ICreateWgSocksClientBody,
  ICreateWgSocksUserBody,
  IUpdateWgSocksBody,
  IUpdateWgSocksUserBody,
  IWgSocksUserSecretDto,
  WgSocksClientDto,
  WgSocksServiceDto,
} from "./dto";
import {
  AssignWgSocksSchema,
  CreateWgSocksClientSchema,
  CreateWgSocksSchema,
  CreateWgSocksUserSchema,
  UpdateWgSocksSchema,
  UpdateWgSocksUserSchema,
} from "./validation";
import { WgSocksAppService } from "./wg-socks.service";
import { WgSocksClientKitService } from "./wg-socks-client-kit.service";

/**
 * SOCKS5-прокси через mTLS на нодах: пользователи SOCKS5, клиентские
 * сертификаты, готовый клиент для устройства.
 */
@Injectable()
@Tags("WgSocks")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/socks")
export class WgSocksController extends Controller {
  constructor(
    @inject(WgSocksAppService) private readonly _service: WgSocksAppService,
    @inject(WgSocksClientKitService)
    private readonly _kits: WgSocksClientKitService,
  ) {
    super();
  }

  /**
   * Новый прокси на ноде (видимой автору) со своим CA и серверным
   * сертификатом. Создатель — автор запроса; владелец, отличный от себя, —
   * только с правом `wg:socks:assign`.
   * @summary Создание прокси
   */
  @Security("jwt", ["permission:wg:socks:create"])
  @ValidateBody(CreateWgSocksSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgSocks(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    return this._service.create(getContextUser(req), body);
  }

  /**
   * Прокси с пользователями, клиентами и live-показателями. С правом
   * `wg:socks:view:own` — только свои (владелец или создатель).
   * @param mine Только свои прокси (владелец или создатель) при любой области прав
   * @summary Список прокси
   */
  @Security("jwt", ["permission:wg:socks:view:own"])
  @Get()
  listWgSocks(
    @Request() req: KoaRequest,
    @Query() mine?: boolean,
  ): Promise<WgSocksServiceDto[]> {
    return this._service.list(getContextUser(req), mine);
  }

  /**
   * Прокси по id; чужой без права на все прокси — 404.
   * @summary Прокси
   */
  @Security("jwt", ["permission:wg:socks:view:own"])
  @Get("{id}")
  getWgSocks(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgSocksServiceDto> {
    return this._service.get(getContextUser(req), id);
  }

  /**
   * @summary Изменение прокси
   */
  @Security("jwt", ["permission:wg:socks:update:own"])
  @ValidateBody(UpdateWgSocksSchema)
  @Patch("{id}")
  updateWgSocks(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    return this._service.update(getContextUser(req), id, body);
  }

  /**
   * @summary Удаление прокси
   */
  @Security("jwt", ["permission:wg:socks:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgSocks(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._service.delete(getContextUser(req), id);
  }

  /**
   * Назначить владельца прокси (он станет для него своим).
   * @summary Назначение владельца прокси
   */
  @Security("jwt", ["permission:wg:socks:assign:own"])
  @ValidateBody(AssignWgSocksSchema)
  @Post("{id}/assign")
  assignWgSocks(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    return this._service.assign(getContextUser(req), id, body);
  }

  /**
   * Снять владельца прокси.
   * @summary Снятие владельца прокси
   */
  @Security("jwt", ["permission:wg:socks:assign:own"])
  @Post("{id}/revoke")
  revokeWgSocks(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgSocksServiceDto> {
    return this._service.revoke(getContextUser(req), id);
  }

  /**
   * Пользователь SOCKS5; без пароля — сгенерированный. Пароль — в ответе.
   * @summary Пользователь прокси
   */
  @Security("jwt", ["permission:wg:socks:users:own"])
  @ValidateBody(CreateWgSocksUserSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/users")
  addWgSocksUser(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: ICreateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.addUser(getContextUser(req), id, body);
  }

  /**
   * Включить/выключить пользователя или сменить пароль.
   * @summary Изменение пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:users:own"])
  @ValidateBody(UpdateWgSocksUserSchema)
  @Patch("{id}/users/{userId}")
  updateWgSocksUser(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() userId: UUID,
    @Body() body: IUpdateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.updateUser(getContextUser(req), id, userId, body);
  }

  /**
   * @summary Удаление пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:users:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}/users/{userId}")
  async removeWgSocksUser(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() userId: UUID,
  ): Promise<void> {
    await this._service.removeUser(getContextUser(req), id, userId);
  }

  /**
   * Пароль пользователя (для настройки Telegram).
   * @summary Пароль пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:secrets:own"])
  @Get("{id}/users/{userId}/secret")
  getWgSocksUserSecret(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() userId: UUID,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.userSecret(getContextUser(req), id, userId);
  }

  /**
   * Новый клиентский сертификат (устройство).
   * @summary Клиент прокси
   */
  @Security("jwt", ["permission:wg:socks:clients:own"])
  @ValidateBody(CreateWgSocksClientSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/clients")
  issueWgSocksClient(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: ICreateWgSocksClientBody,
  ): Promise<WgSocksClientDto> {
    return this._service.issueClient(getContextUser(req), id, body);
  }

  /**
   * Отозвать сертификат: агент сразу перестаёт пускать устройство.
   * @summary Отзыв клиента прокси
   */
  @Security("jwt", ["permission:wg:socks:clients:own"])
  @Post("{id}/clients/{clientId}/revoke")
  revokeWgSocksClient(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() clientId: UUID,
  ): Promise<WgSocksClientDto> {
    return this._service.revokeClient(getContextUser(req), id, clientId);
  }

  /**
   * Готовый клиент для macOS (zip): `install.sh` ставит stunnel, раскладывает
   * сертификаты и включает автозапуск; README — настройки для Telegram.
   * Без `userId` берётся первый включённый пользователь.
   * @summary Клиент прокси для Mac
   */
  @Security("jwt", ["permission:wg:socks:clients:own"])
  @Produces("application/zip")
  @Get("{id}/clients/{clientId}/mac")
  async getWgSocksMacClient(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() clientId: UUID,
    @Query() userId?: UUID,
  ): Promise<Buffer> {
    const { fileName, content } = await this._kits.macClient(
      getContextUser(req),
      id,
      clientId,
      userId,
    );

    this.setHeader("Content-Type", "application/zip");
    this.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return content;
  }
}
