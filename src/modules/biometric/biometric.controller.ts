import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  getContextUser,
  getDeviceInfo,
  Injectable,
  ThrottleGuard,
  UseGuards,
  ValidateBody,
} from "../../core";
import { KoaRequest } from "../../types/koa";
import { setRefreshCookie } from "../auth";
import {
  IBiometricDevicesResponseDto,
  IGenerateNonceRequestDto,
  IGenerateNonceResponseDto,
  IRegisterBiometricRequestDto,
  IRegisterBiometricResponseDto,
  IVerifyBiometricSignatureRequestDto,
  IVerifyBiometricSignatureResponseDto,
} from "./biometric.dto";
import { BiometricService } from "./biometric.service";
import {
  GenerateNonceSchema,
  RegisterBiometricSchema,
  VerifyBiometricSignatureSchema,
} from "./validation";

@Injectable()
@Tags("Biometric")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/biometric")
export class BiometricController extends Controller {
  constructor(
    @inject(BiometricService) private biometricService: BiometricService,
  ) {
    super();
  }

  /**
   * Регистрирует публичный ключ устройства для входа по биометрии.
   * @summary Регистрация биометрии
   * @response 409 - Достигнут лимит устройств (BIOMETRIC_DEVICE_LIMIT)
   */
  @Security("jwt")
  @Post("/register")
  @ValidateBody(RegisterBiometricSchema)
  async registerBiometric(
    @Request() req: KoaRequest,
    @Body() body: IRegisterBiometricRequestDto,
  ): Promise<IRegisterBiometricResponseDto> {
    const { userId } = getContextUser(req);

    await this.biometricService.registerBiometric(
      userId,
      body.deviceId,
      body.deviceName,
      body.publicKey,
    );

    return { registered: true };
  }

  /**
   * Выдаёт одноразовый nonce (5 минут), который устройство подписывает своим
   * ключом. Публичный: вызывается до входа.
   * @summary Nonce для биометрического входа
   */
  @UseGuards(ThrottleGuard(10, 60_000, "biometric:generate-nonce"))
  @Post("/generate-nonce")
  @ValidateBody(GenerateNonceSchema)
  async generateNonce(
    @Body() body: IGenerateNonceRequestDto,
  ): Promise<IGenerateNonceResponseDto> {
    return this.biometricService.generateNonce(body.userId, body.deviceId);
  }

  /**
   * Проверяет подпись nonce и открывает новую сессию. Публичный; nonce
   * одноразовый — одна попытка на nonce.
   * @summary Вход по биометрии
   * @response 401 - Подпись или nonce не прошли проверку (BIOMETRIC_VERIFY_FAILED)
   */
  @UseGuards(ThrottleGuard(10, 60_000, "biometric:verify-signature"))
  @Post("/verify-signature")
  @ValidateBody(VerifyBiometricSignatureSchema)
  async verifySignature(
    @Request() req: KoaRequest,
    @Body() body: IVerifyBiometricSignatureRequestDto,
  ): Promise<IVerifyBiometricSignatureResponseDto> {
    const result = await this.biometricService.verifyBiometricSignature(
      body,
      getDeviceInfo(req),
    );

    setRefreshCookie(req.ctx, result.tokens);

    return result;
  }

  /**
   * Список зарегистрированных устройств пользователя.
   * @summary Мои биометрические устройства
   */
  @Security("jwt")
  @Get("/devices")
  async getDevices(
    @Request() req: KoaRequest,
  ): Promise<IBiometricDevicesResponseDto> {
    const { userId } = getContextUser(req);
    const devices = await this.biometricService.getDevices(userId);

    return {
      devices: devices.map(d => ({
        id: d.id,
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        lastUsedAt: d.lastUsedAt,
        createdAt: d.createdAt,
      })),
    };
  }

  /**
   * Удаляет зарегистрированное устройство.
   * @summary Удаление биометрического устройства
   * @response 404 - Устройство не найдено (BIOMETRIC_DEVICE_NOT_FOUND)
   */
  @Security("jwt")
  @Delete("/{deviceId}")
  @SuccessResponse(204, "No Content")
  async deleteDevice(
    @Request() req: KoaRequest,
    @Path() deviceId: string,
  ): Promise<void> {
    const { userId } = getContextUser(req);

    await this.biometricService.deleteDevice(userId, deviceId);
    this.setStatus(204);
  }
}
