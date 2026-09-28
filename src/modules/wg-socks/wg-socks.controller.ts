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
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { Injectable, ValidateBody } from "../../core";
import { UUID } from "../../core/http";
import {
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
   * Новый прокси на ноде со своим CA и серверным сертификатом.
   * @summary Создание прокси
   */
  @Security("jwt", ["permission:wg:socks:create"])
  @ValidateBody(CreateWgSocksSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgSocks(@Body() body: ICreateWgSocksBody): Promise<WgSocksServiceDto> {
    return this._service.create(body);
  }

  /**
   * Прокси с пользователями, клиентами и live-показателями.
   * @summary Список прокси
   */
  @Security("jwt", ["permission:wg:socks:view"])
  @Get()
  listWgSocks(): Promise<WgSocksServiceDto[]> {
    return this._service.list();
  }

  /**
   * @summary Прокси
   */
  @Security("jwt", ["permission:wg:socks:view"])
  @Get("{id}")
  getWgSocks(@Path() id: UUID): Promise<WgSocksServiceDto> {
    return this._service.get(id);
  }

  /**
   * @summary Изменение прокси
   */
  @Security("jwt", ["permission:wg:socks:update"])
  @ValidateBody(UpdateWgSocksSchema)
  @Patch("{id}")
  updateWgSocks(
    @Path() id: UUID,
    @Body() body: IUpdateWgSocksBody,
  ): Promise<WgSocksServiceDto> {
    return this._service.update(id, body);
  }

  /**
   * @summary Удаление прокси
   */
  @Security("jwt", ["permission:wg:socks:delete"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgSocks(@Path() id: UUID): Promise<void> {
    await this._service.delete(id);
  }

  /**
   * Пользователь SOCKS5; без пароля — сгенерированный. Пароль — в ответе.
   * @summary Пользователь прокси
   */
  @Security("jwt", ["permission:wg:socks:users"])
  @ValidateBody(CreateWgSocksUserSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/users")
  addWgSocksUser(
    @Path() id: UUID,
    @Body() body: ICreateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.addUser(id, body);
  }

  /**
   * Включить/выключить пользователя или сменить пароль.
   * @summary Изменение пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:users"])
  @ValidateBody(UpdateWgSocksUserSchema)
  @Patch("{id}/users/{userId}")
  updateWgSocksUser(
    @Path() id: UUID,
    @Path() userId: UUID,
    @Body() body: IUpdateWgSocksUserBody,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.updateUser(id, userId, body);
  }

  /**
   * @summary Удаление пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:users"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}/users/{userId}")
  async removeWgSocksUser(
    @Path() id: UUID,
    @Path() userId: UUID,
  ): Promise<void> {
    await this._service.removeUser(id, userId);
  }

  /**
   * Пароль пользователя (для настройки Telegram).
   * @summary Пароль пользователя прокси
   */
  @Security("jwt", ["permission:wg:socks:secrets"])
  @Get("{id}/users/{userId}/secret")
  getWgSocksUserSecret(
    @Path() id: UUID,
    @Path() userId: UUID,
  ): Promise<IWgSocksUserSecretDto> {
    return this._service.userSecret(id, userId);
  }

  /**
   * Новый клиентский сертификат (устройство).
   * @summary Клиент прокси
   */
  @Security("jwt", ["permission:wg:socks:clients"])
  @ValidateBody(CreateWgSocksClientSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/clients")
  issueWgSocksClient(
    @Path() id: UUID,
    @Body() body: ICreateWgSocksClientBody,
  ): Promise<WgSocksClientDto> {
    return this._service.issueClient(id, body);
  }

  /**
   * Отозвать сертификат: агент сразу перестаёт пускать устройство.
   * @summary Отзыв клиента прокси
   */
  @Security("jwt", ["permission:wg:socks:clients"])
  @Post("{id}/clients/{clientId}/revoke")
  revokeWgSocksClient(
    @Path() id: UUID,
    @Path() clientId: UUID,
  ): Promise<WgSocksClientDto> {
    return this._service.revokeClient(id, clientId);
  }

  /**
   * Готовый клиент для macOS (zip): `install.sh` ставит stunnel, раскладывает
   * сертификаты и включает автозапуск; README — настройки для Telegram.
   * Без `userId` берётся первый включённый пользователь.
   * @summary Клиент прокси для Mac
   */
  @Security("jwt", ["permission:wg:socks:clients"])
  @Produces("application/zip")
  @Get("{id}/clients/{clientId}/mac")
  async getWgSocksMacClient(
    @Path() id: UUID,
    @Path() clientId: UUID,
    @Query() userId?: UUID,
  ): Promise<Buffer> {
    const { fileName, content } = await this._kits.macClient(
      id,
      clientId,
      userId,
    );

    this.setHeader("Content-Type", "application/zip");
    this.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return content;
  }
}
