import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
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
  getDeviceInfo,
  Injectable,
  ThrottleGuard,
  UseGuards,
} from "../../core";
import { KoaRequest } from "../../types/koa";
import { setRefreshCookie } from "../auth";
import {
  IGenerateAuthenticationOptionsRequestDto,
  IVerifyAuthenticationRequestDto,
  IVerifyAuthenticationResponseDto,
  IVerifyRegistrationRequestDto,
  IVerifyRegistrationResponseDto,
  PasskeyDto,
} from "./passkeys.dto";
import { PasskeysService } from "./passkeys.service";
import {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "./webauthn.dto";

@Injectable()
@Tags("Passkeys")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/passkeys")
export class PasskeysController extends Controller {
  constructor(
    @inject(PasskeysService) private _passkeysService: PasskeysService,
  ) {
    super();
  }

  /**
   * Список passkeys текущего пользователя (новые — первыми).
   *
   * @summary Мои passkeys
   * @param offset Смещение (по умолчанию 0)
   * @param limit Размер страницы (по умолчанию 20, максимум 100)
   */
  @Security("jwt")
  @Get()
  getPasskeys(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<PasskeyDto>> {
    const { userId } = getContextUser(req);

    return this._passkeysService.getPasskeys(userId, offset, limit);
  }

  /**
   * Удаляет passkey текущего пользователя.
   *
   * @summary Удаление passkey
   * @param id Credential ID passkey
   * @response 404 - Passkey не найден (PASSKEY_NOT_FOUND)
   */
  @Security("jwt")
  @Delete("{id}")
  @SuccessResponse(204, "No Content")
  async deletePasskey(
    @Request() req: KoaRequest,
    @Path() id: string,
  ): Promise<void> {
    const { userId } = getContextUser(req);

    await this._passkeysService.deletePasskey(userId, id);
    this.setStatus(204);
  }

  /**
   * Генерирует параметры для регистрации нового passkey.
   * Требует авторизации — passkey привязывается к текущему пользователю.
   *
   * @summary Параметры регистрации passkey
   */
  @Security("jwt")
  @Post("/generate-registration-options")
  generateRegistrationOptions(
    @Request() req: KoaRequest,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { userId } = getContextUser(req);

    return this._passkeysService.generateRegistrationOptions(userId);
  }

  /**
   * Верифицирует ответ устройства и сохраняет passkey для текущего пользователя.
   *
   * @summary Верификация регистрации passkey
   * @response 400 - Ответ устройства не прошёл проверку
   * @response 409 - Passkey уже зарегистрирован
   */
  @Security("jwt")
  @Post("/verify-registration")
  verifyRegistration(
    @Request() req: KoaRequest,
    @Body() body: IVerifyRegistrationRequestDto,
  ): Promise<IVerifyRegistrationResponseDto> {
    const { userId } = getContextUser(req);

    return this._passkeysService.verifyRegistration(userId, body.data);
  }

  /**
   * Генерирует параметры для аутентификации по passkey.
   * Принимает login (email или телефон) пользователя.
   *
   * @summary Параметры аутентификации passkey
   * @response 404 - Passkey не найден
   */
  @UseGuards(ThrottleGuard(10, 60_000, "passkeys:authentication-options"))
  @Post("/generate-authentication-options")
  generateAuthenticationOptions(
    @Body() body: IGenerateAuthenticationOptionsRequestDto,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return this._passkeysService.generateAuthenticationOptions(body.login);
  }

  /**
   * Верифицирует ответ устройства и возвращает токены при успехе.
   *
   * @summary Аутентификация по passkey
   * @response 401 - Passkey не подтверждён (PASSKEY_AUTH_FAILED)
   */
  @UseGuards(ThrottleGuard(10, 60_000, "passkeys:verify-authentication"))
  @Post("/verify-authentication")
  async verifyAuthentication(
    @Request() req: KoaRequest,
    @Body() body: IVerifyAuthenticationRequestDto,
  ): Promise<IVerifyAuthenticationResponseDto> {
    const result = await this._passkeysService.verifyAuthentication(
      body.data,
      getDeviceInfo(req),
    );

    setRefreshCookie(req.ctx, result.tokens);

    return result;
  }
}
