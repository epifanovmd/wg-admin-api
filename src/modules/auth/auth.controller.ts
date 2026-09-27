import { inject } from "inversify";
import {
  Body,
  Controller,
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
  ApiResponseDto,
  getContextUser,
  getDeviceInfo,
  HttpException,
  Injectable,
  ITokensDto,
  ThrottleGuard,
  UseGuards,
  ValidateBody,
} from "../../core";
import { KoaRequest } from "../../types/koa";
import {
  IDeviceInfo,
  IDisable2FARequestDto,
  IEnable2FARequestDto,
  IRefreshRequestDto,
  ISignInRequestDto,
  ISignInResponseDto,
  IUserLoginRequestDto,
  IUserResetPasswordRequestDto,
  IUserWithTokensDto,
  IVerify2FARequestDto,
  TSignUpRequestDto,
} from "./auth.dto";
import { AuthError } from "./auth.errors";
import { AuthService } from "./auth.service";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from "./refresh-cookie";
import {
  Disable2FASchema,
  Enable2FASchema,
  RefreshSchema,
  RequestResetPasswordSchema,
  ResetPasswordSchema,
  SignInSchema,
  SignUpSchema,
  Verify2FASchema,
} from "./validation";

/** Коды, для которых клиенту отдаётся `Retry-After`. */
const RETRY_AFTER_CODES = new Set<string>([
  AuthError.codes.ACCOUNT_LOCKED,
  AuthError.codes.TOO_MANY_ATTEMPTS,
]);

/** Блокировка входа → заголовок `Retry-After` из `details.retryAfter`. */
const withRetryAfter = async <T>(
  req: KoaRequest,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    const retryAfter =
      error instanceof HttpException && RETRY_AFTER_CODES.has(error.code)
        ? (error.reason as { retryAfter?: number } | undefined)?.retryAfter
        : undefined;

    if (retryAfter) req.ctx.set("Retry-After", String(retryAfter));
    throw error;
  }
};

@Injectable()
@Tags("Authorization")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/auth")
export class AuthController extends Controller {
  constructor(@inject(AuthService) private _authService: AuthService) {
    super();
  }

  /**
   * Регистрация нового пользователя
   * @summary Регистрация
   * @description Создает новую учетную запись и возвращает токены доступа.
   * @param body Данные для регистрации
   * @example body {
   *   "email": "user@example.com",
   *   "password": "Correct-Horse-42",
   *   "firstName": "John",
   *   "lastName": "Doe"
   * }
   * @response 400 - Некорректные данные или пароль не прошёл политику (VALIDATION_ERROR)
   * @response 409 - Email или телефон уже зарегистрирован (AUTH_USER_EXISTS)
   */
  @UseGuards(ThrottleGuard(5, 60_000, "auth:sign-up"))
  @Post("/sign-up")
  @SuccessResponse(201, "Created")
  @ValidateBody(SignUpSchema)
  async signUp(
    @Request() req: KoaRequest,
    @Body() body: TSignUpRequestDto,
  ): Promise<IUserWithTokensDto> {
    const result = await this._authService.signUp(
      body,
      this._extractDeviceInfo(req),
    );

    this.setStatus(201);
    setRefreshCookie(req.ctx, result.tokens);

    return result;
  }

  /**
   * Авторизация пользователя
   * @summary Вход в систему
   * @description Проверяет учетные данные и возвращает токены доступа.
   * @param body Данные для входа
   * @example body {
   *   "login": "epifanovmd@gmail.com",
   *   "password": "Epifan123"
   * }
   * @response 200 - Успешный вход
   * @response 401 - Неверные учетные данные (AUTH_INVALID_CREDENTIALS)
   * @response 429 - Вход в аккаунт временно заблокирован (AUTH_ACCOUNT_LOCKED, заголовок Retry-After)
   */
  @UseGuards(ThrottleGuard(10, 60_000, "auth:sign-in"))
  @Post("/sign-in")
  @ValidateBody(SignInSchema)
  async signIn(
    @Request() req: KoaRequest,
    @Body() body: ISignInRequestDto,
  ): Promise<ISignInResponseDto> {
    const result = await withRetryAfter(req, () =>
      this._authService.signIn(body, this._extractDeviceInfo(req)),
    );

    if ("tokens" in result) setRefreshCookie(req.ctx, result.tokens);

    return result;
  }

  /**
   * Запрос на сброс пароля
   * @summary Запрос сброса пароля
   * @description Отправляет письмо со ссылкой для восстановления пароля.
   * Ответ одинаков независимо от того, существует ли пользователь.
   * @param body Логин (email или телефон)
   * @example body {
   *   "login": "user@example.com"
   * }
   * @response 200 - Запрос принят
   */
  @UseGuards(ThrottleGuard(3, 300_000, "auth:request-reset-password"))
  @Post("/request-reset-password")
  @ValidateBody(RequestResetPasswordSchema)
  requestResetPassword(
    @Body() body: IUserLoginRequestDto,
  ): Promise<ApiResponseDto> {
    return this._authService.requestResetPassword(body.login);
  }

  /**
   * Сброс пароля
   * @summary Смена пароля
   * @description Позволяет установить новый пароль, используя токен сброса.
   * @param body Токен и новый пароль
   * @example body {
   *   "token": "reset-token-123",
   *   "password": "newSecurePassword"
   * }
   * @response 200 - Пароль успешно изменен
   * @response 400 - Некорректный, использованный или просроченный токен (AUTH_RESET_TOKEN_INVALID) или слабый пароль (VALIDATION_ERROR)
   */
  @UseGuards(ThrottleGuard(10, 300_000, "auth:reset-password"))
  @Post("/reset-password")
  @ValidateBody(ResetPasswordSchema)
  resetPassword(
    @Body() body: IUserResetPasswordRequestDto,
  ): Promise<ApiResponseDto> {
    return this._authService.resetPassword(body.token, body.password);
  }

  /**
   * Обновление токенов доступа
   * @summary Обновление токенов
   * @description Выдает новый access и refresh токены на основе старого refresh токена.
   * Токен берётся из тела, а если его там нет — из httpOnly-cookie `refresh_token`
   * (при включённом `AUTH_REFRESH_COOKIE`).
   * Повторное использование уже обменянного refresh-токена завершает сессию.
   * @param body Тело запроса с refresh токеном
   * @example body {
   *   "refreshToken": "old-refresh-token"
   * }
   * @response 200 - Успешное обновление токенов
   * @response 401 - Неверный, просроченный или повторно использованный refresh-токен
   */
  @UseGuards(ThrottleGuard(30, 60_000, "auth:refresh"))
  @Post("/refresh")
  @ValidateBody(RefreshSchema)
  async refresh(
    @Request() req: KoaRequest,
    @Body() body: IRefreshRequestDto,
  ): Promise<ITokensDto> {
    const tokens = await this._authService.updateTokens(
      body?.refreshToken || readRefreshCookie(req.ctx),
    );

    setRefreshCookie(req.ctx, tokens);

    return tokens;
  }

  /**
   * Выйти из текущей сессии: сессия завершается, access-токен сразу
   * перестаёт действовать, cookie с refresh-токеном очищается.
   * @summary Выход
   */
  @Security("jwt")
  @Post("/sign-out")
  @SuccessResponse(204, "No Content")
  async signOut(@Request() req: KoaRequest): Promise<void> {
    await this._authService.signOut(
      getContextUser(req),
      this._extractDeviceInfo(req),
    );
    clearRefreshCookie(req.ctx);
    this.setStatus(204);
  }

  /**
   * Выйти со всех устройств, включая текущее: все сессии завершаются,
   * их access-токены сразу перестают действовать.
   * @summary Выход со всех устройств
   */
  @Security("jwt")
  @UseGuards(ThrottleGuard(5, 60_000, "auth:sign-out-all"))
  @Post("/sign-out-all")
  @SuccessResponse(204, "No Content")
  async signOutAll(@Request() req: KoaRequest): Promise<void> {
    await this._authService.signOutAll(
      getContextUser(req),
      this._extractDeviceInfo(req),
    );
    clearRefreshCookie(req.ctx);
    this.setStatus(204);
  }

  /**
   * Включить двухфакторную аутентификацию. Требует текущий пароль аккаунта.
   * @summary Включение 2FA
   * @response 403 - Неверный текущий пароль
   */
  @Security("jwt")
  @UseGuards(ThrottleGuard(5, 300_000, "auth:2fa-settings"))
  @Post("/enable-2fa")
  @ValidateBody(Enable2FASchema)
  enable2FA(
    @Request() req: KoaRequest,
    @Body() body: IEnable2FARequestDto,
  ): Promise<ApiResponseDto> {
    const user = getContextUser(req);

    return this._authService.enable2FA(
      user.userId,
      body.currentPassword,
      body.password,
      body.hint,
      this._extractDeviceInfo(req),
    );
  }

  /**
   * Отключить двухфакторную аутентификацию. Требует текущий пароль аккаунта
   * и пароль 2FA.
   * @summary Отключение 2FA
   * @response 403 - Неверный текущий пароль или пароль 2FA
   */
  @Security("jwt")
  @UseGuards(ThrottleGuard(5, 300_000, "auth:2fa-settings"))
  @Post("/disable-2fa")
  @ValidateBody(Disable2FASchema)
  disable2FA(
    @Request() req: KoaRequest,
    @Body() body: IDisable2FARequestDto,
  ): Promise<ApiResponseDto> {
    const user = getContextUser(req);

    return this._authService.disable2FA(
      user.userId,
      body.currentPassword,
      body.password,
      this._extractDeviceInfo(req),
    );
  }

  /**
   * Верифицировать 2FA и получить токены. Токен 2FA одноразовый; после
   * нескольких неверных паролей вход по 2FA временно блокируется.
   * @summary Верификация 2FA
   * @response 401 - Неверный пароль или токен 2FA
   * @response 429 - Слишком много попыток (AUTH_TOO_MANY_ATTEMPTS, заголовок Retry-After)
   */
  @UseGuards(ThrottleGuard(5, 60_000, "auth:verify-2fa"))
  @Post("/verify-2fa")
  @ValidateBody(Verify2FASchema)
  async verify2FA(
    @Request() req: KoaRequest,
    @Body() body: IVerify2FARequestDto,
  ): Promise<IUserWithTokensDto> {
    const result = await withRetryAfter(req, () =>
      this._authService.verify2FA(
        body.twoFactorToken,
        body.password,
        this._extractDeviceInfo(req),
      ),
    );

    setRefreshCookie(req.ctx, result.tokens);

    return result;
  }

  private _extractDeviceInfo(req: KoaRequest): IDeviceInfo {
    return getDeviceInfo(req);
  }
}
