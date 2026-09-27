import { inject } from "inversify";

import { normalizePhone } from "../../common";
import {
  ApiResponseDto,
  EventBus,
  hashPassword,
  HttpException,
  Injectable,
  isUniqueViolation,
  ITokensDto,
  logger,
  TokenService,
  validatePasswordPolicy,
  ValidationException,
  verifyPassword,
} from "../../core";
import { AuthContext } from "../../types/koa";
import { MailerService } from "../mailer";
import { ResetPasswordTokensService } from "../reset-password-tokens";
import { SessionService } from "../session";
import { PasswordChangedEvent, UserService } from "../user";
import { User } from "../user/user.entity";
import { AccountLockout } from "./account-lockout";
import {
  IDeviceInfo,
  ISignInRequestDto,
  ISignInResponseDto,
  IUserWithTokensDto,
  TSignUpRequestDto,
} from "./auth.dto";
import { AuthError } from "./auth.errors";
import { IAuthRequestMeta, TLoginMethod } from "./auth.types";
import { AuthAttemptsStore, IAttemptsStore } from "./auth-attempts.store";
import {
  AccountLockedEvent,
  LoginFailedEvent,
  TwoFactorDisabledEvent,
  TwoFactorEnabledEvent,
  UserLoggedInEvent,
  UserSignedOutEvent,
} from "./events";
import { toTokenSubject } from "./token-subject";

/** Неверных вводов 2FA-пароля до блокировки. */
export const TWO_FACTOR_MAX_FAILURES = 5;

/** Окно подсчёта неудач 2FA и длительность блокировки. */
export const TWO_FACTOR_LOCK_MS = 15 * 60_000;

const RESET_REQUESTED =
  "Если пользователь с таким email/телефоном существует, ссылка для сброса пароля будет отправлена.";

/** Логин — email (по `@`) или телефон, приведённый к хранимому виду. */
const loginToAttr = (login: string): { email: string } | { phone: string } => {
  const value = login.trim();

  return value.includes("@")
    ? { email: value.toLowerCase() }
    : { phone: normalizePhone(value) };
};

/** Хеш-заглушка: вход по несуществующему логину тратит то же время на проверку. */
let dummyHash: Promise<string> | undefined;

const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password"));

const toRequestMeta = ({ ip, userAgent }: IDeviceInfo): IAuthRequestMeta => ({
  ip,
  userAgent,
});

/** Пароль не прошёл политику — 400 с полем `password`. */
const assertPasswordPolicy = (password: string, email?: string | null) => {
  const problem = validatePasswordPolicy(password, { email });

  if (problem) throw new ValidationException({ password: problem });
};

/** Сервис аутентификации: регистрация, вход, 2FA, сброс пароля, токены и выход. */
@Injectable()
export class AuthService {
  private readonly _lockout: AccountLockout;

  constructor(
    @inject(UserService) private _userService: UserService,
    @inject(MailerService) private _mailerService: MailerService,
    @inject(ResetPasswordTokensService)
    private _resetPasswordTokensService: ResetPasswordTokensService,
    @inject(TokenService) private _tokenService: TokenService,
    @inject(EventBus) private _eventBus: EventBus,
    @inject(SessionService) private _sessionService: SessionService,
    @inject(AuthAttemptsStore) private _attempts: IAttemptsStore,
  ) {
    this._lockout = new AccountLockout(_attempts);
  }

  /** Зарегистрировать пользователя (email и телефон уникальны) и выдать токены. */
  async signUp(
    {
      email: rawEmail,
      phone: rawPhone,
      password,
      firstName,
      lastName,
    }: TSignUpRequestDto,
    deviceInfo: IDeviceInfo = {},
  ): Promise<IUserWithTokensDto> {
    const email = rawEmail?.trim().toLowerCase() || undefined;
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;

    if (!email && !phone) {
      throw AuthError.LOGIN_REQUIRED();
    }

    assertPasswordPolicy(password, email);

    if (await this._findUser({ email, phone })) {
      throw AuthError.USER_EXISTS();
    }

    try {
      await this._userService.createUser(
        {
          email: email ?? null,
          phone: phone ?? null,
          passwordHash: await hashPassword(password),
        },
        undefined,
        {
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
        },
      );
    } catch (error) {
      // Параллельная регистрация с теми же данными
      if (isUniqueViolation(error)) throw AuthError.USER_EXISTS();
      throw error;
    }

    const user = await this._userService.getUserByAttr(
      email ? { email } : { phone },
    );

    return this._logIn(user, deviceInfo, "sign-up");
  }

  /**
   * Аутентифицировать пользователя по логину (email/телефон) и паролю.
   * Неудачи считаются на аккаунт: после `LOGIN_MAX_FAILURES` вход закрыт
   * на `LOGIN_LOCK_MS` (429 `AUTH_ACCOUNT_LOCKED`, `details.retryAfter`).
   */
  async signIn(
    { login, password }: ISignInRequestDto,
    deviceInfo: IDeviceInfo = {},
  ): Promise<ISignInResponseDto> {
    const attr = loginToAttr(login);
    const user = await this._findUser(attr);
    const lockKey = user
      ? `user:${user.id}`
      : `login:${"email" in attr ? attr.email : attr.phone}`;
    const request = toRequestMeta(deviceInfo);
    const lock = await this._lockout.status(lockKey);

    if (lock.locked) {
      this._eventBus.emit(
        new LoginFailedEvent(user?.id ?? null, login, "locked", request),
      );
      throw AuthError.ACCOUNT_LOCKED({ retryAfter: lock.retryAfterSec });
    }

    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await getDummyHash()),
    );

    if (!user || !valid) {
      const failure = await this._lockout.registerFailure(lockKey);

      this._eventBus.emit(
        new LoginFailedEvent(
          user?.id ?? null,
          login,
          "invalid-credentials",
          request,
        ),
      );

      if (failure.locked) {
        this._eventBus.emit(
          new AccountLockedEvent(
            user?.id ?? null,
            login,
            new Date(Date.now() + failure.retryAfterSec * 1000),
            request,
          ),
        );
        throw AuthError.ACCOUNT_LOCKED({ retryAfter: failure.retryAfterSec });
      }

      throw AuthError.INVALID_CREDENTIALS();
    }

    await this._lockout.reset(lockKey);

    if (user.twoFactorHash) {
      return {
        require2FA: true,
        twoFactorToken: await this._tokenService.issueTwoFactor(user.id),
        twoFactorHint: user.twoFactorHint ?? undefined,
      };
    }

    return this._logIn(user, deviceInfo, "password");
  }

  /**
   * Открыть сессию уже аутентифицированному пользователю (passkey,
   * биометрия): токены, событие входа, общий для всех способов путь.
   */
  completeLogin(
    user: User,
    deviceInfo: IDeviceInfo,
    method: TLoginMethod,
  ): Promise<IUserWithTokensDto> {
    return this._logIn(user, deviceInfo, method);
  }

  /**
   * Инициировать сброс пароля. Ответ и время ответа не зависят от того,
   * существует ли пользователь: письмо уходит в фоне, ошибка — только в лог.
   */
  async requestResetPassword(login: string): Promise<ApiResponseDto> {
    const user = await this._findUser(loginToAttr(login));

    if (user?.email) {
      void this._sendResetMail(user.id, user.email, user.profile?.locale);
    }

    return new ApiResponseDto({ message: RESET_REQUESTED });
  }

  /**
   * Установить новый пароль по одноразовому токену. Пароль проверяется
   * политикой до того, как токен израсходован. 2FA сбрасывается (её пароль
   * мог быть утерян вместе с основным), блокировка входа снимается. Все
   * сессии завершает слушатель `PasswordChangedEvent` — единственная точка.
   */
  async resetPassword(token: string, password: string) {
    const { userId: ownerId } =
      await this._resetPasswordTokensService.peek(token);
    const owner = await this._userService.getUser(ownerId);

    assertPasswordPolicy(password, owner.email);

    const { userId } = await this._resetPasswordTokensService.check(token);

    await this._userService.update2FA(userId, null, null);
    await this._userService.changePassword(userId, password);
    await this._lockout.unlock(`user:${userId}`);

    // Ждём слушателей: старые сессии отозваны к моменту ответа.
    await this._eventBus.emitAsync(new PasswordChangedEvent(userId, "reset"));

    return new ApiResponseDto({ message: "Пароль успешно сброшен." });
  }

  /**
   * Обновить пару токенов. Refresh сверяется с сессией и атомарно ротируется;
   * повторное использование старого токена завершает сессию.
   */
  async updateTokens(token?: string): Promise<ITokensDto> {
    if (!token) {
      throw AuthError.REFRESH_TOKEN_MISSING();
    }

    const decoded = await this._tokenService.verifyRefresh(token);
    const session = await this._sessionService.validateRefresh(decoded, token);
    const user = await this._userService.getUser(session.userId);
    const tokens = await this._tokenService.issue(
      toTokenSubject(user),
      session.id,
    );

    return this._sessionService.rotateRefreshToken(session, token, tokens);
  }

  /**
   * Выйти из текущей сессии: сессия удаляется, её access-токен сразу
   * отзывается. Уже завершённая сессия — не ошибка (повторный выход).
   */
  async signOut(caller: AuthContext, request: IAuthRequestMeta = {}) {
    try {
      await this._sessionService.terminateSession(
        caller.sessionId,
        caller.userId,
        "sign-out",
      );
    } catch (error) {
      if (!(error instanceof HttpException && error.status === 404)) {
        throw error;
      }
      await this._tokenService.revokeSessions([caller.sessionId]);
    }

    this._eventBus.emit(
      new UserSignedOutEvent(
        caller.userId,
        caller.sessionId,
        "current",
        request,
      ),
    );
  }

  /** Выйти со всех устройств, включая текущее. */
  async signOutAll(caller: AuthContext, request: IAuthRequestMeta = {}) {
    await this._sessionService.terminateAllByUser(
      caller.userId,
      undefined,
      "sign-out-all",
    );
    // Текущая сессия могла уже исчезнуть из БД — токен отзываем явно.
    await this._tokenService.revokeSessions([caller.sessionId]);

    this._eventBus.emit(
      new UserSignedOutEvent(caller.userId, caller.sessionId, "all", request),
    );
  }

  /** Включить 2FA: нужен текущий пароль аккаунта. */
  async enable2FA(
    userId: string,
    currentPassword: string,
    password: string,
    hint?: string,
    request: IAuthRequestMeta = {},
  ) {
    const user = await this._userService.getUser(userId);

    if (user.twoFactorHash) {
      throw AuthError.TWO_FACTOR_ALREADY_ENABLED();
    }

    await this._assertAccountPassword(user, currentPassword);

    await this._userService.update2FA(
      userId,
      await hashPassword(password),
      hint ?? null,
    );

    this._eventBus.emit(new TwoFactorEnabledEvent(userId, request));

    return new ApiResponseDto({ message: "2FA успешно включена." });
  }

  /** Отключить 2FA: нужны текущий пароль аккаунта и пароль 2FA. */
  async disable2FA(
    userId: string,
    currentPassword: string,
    password: string,
    request: IAuthRequestMeta = {},
  ) {
    const user = await this._userService.getUser(userId);

    if (!user.twoFactorHash) {
      throw AuthError.TWO_FACTOR_NOT_ENABLED();
    }

    await this._assertAccountPassword(user, currentPassword);

    if (!(await verifyPassword(password, user.twoFactorHash))) {
      throw AuthError.TWO_FACTOR_WRONG_PASSWORD();
    }

    await this._userService.update2FA(userId, null, null);

    this._eventBus.emit(new TwoFactorDisabledEvent(userId, request));

    return new ApiResponseDto({ message: "2FA успешно отключена." });
  }

  /**
   * Второй шаг входа. Неудачи считаются на пользователя: после
   * `TWO_FACTOR_MAX_FAILURES` вход по 2FA блокируется на окно. Токен
   * одноразовый — его `jti` гасится при успехе.
   */
  async verify2FA(
    twoFactorToken: string,
    password: string,
    deviceInfo: IDeviceInfo = {},
  ): Promise<IUserWithTokensDto> {
    const { userId, jti, expiresAt } =
      await this._tokenService.verifyTwoFactor(twoFactorToken);
    const failuresKey = `2fa:fail:${userId}`;

    if (
      (await this._attempts.getFailures(failuresKey)) >= TWO_FACTOR_MAX_FAILURES
    ) {
      throw await this._tooManyTwoFactorAttempts(failuresKey);
    }

    const user = await this._userService.getUser(userId);

    if (!user.twoFactorHash) {
      throw AuthError.TWO_FACTOR_NOT_ENABLED();
    }

    if (!(await verifyPassword(password, user.twoFactorHash))) {
      const failures = await this._attempts.addFailure(
        failuresKey,
        TWO_FACTOR_LOCK_MS,
      );

      this._eventBus.emit(
        new LoginFailedEvent(
          userId,
          user.email ?? user.phone ?? "",
          "invalid-2fa",
          toRequestMeta(deviceInfo),
        ),
      );

      if (failures >= TWO_FACTOR_MAX_FAILURES) {
        throw await this._tooManyTwoFactorAttempts(failuresKey);
      }

      throw AuthError.TWO_FACTOR_INVALID();
    }

    const claimed = await this._attempts.claimOnce(
      `2fa:jti:${jti}`,
      Math.max(expiresAt.getTime() - Date.now(), 1_000),
    );

    if (!claimed) {
      throw AuthError.TWO_FACTOR_TOKEN_USED();
    }

    await this._attempts.resetFailures(failuresKey);

    return this._logIn(user, deviceInfo, "2fa");
  }

  private async _tooManyTwoFactorAttempts(failuresKey: string) {
    const ttl = await this._attempts.ttlMs(failuresKey);

    return AuthError.TOO_MANY_ATTEMPTS({
      retryAfter: Math.max(1, Math.ceil(ttl / 1000)),
    });
  }

  private async _logIn(
    user: User,
    deviceInfo: IDeviceInfo,
    method: TLoginMethod,
  ): Promise<IUserWithTokensDto> {
    const { sessionId, tokens, session } =
      await this._sessionService.createAuthenticatedSession(
        toTokenSubject(user),
        deviceInfo,
      );

    this._eventBus.emit(
      new UserLoggedInEvent(
        user.id,
        sessionId,
        session,
        method,
        toRequestMeta(deviceInfo),
      ),
    );

    return { ...(await this._userService.toUserDto(user)), tokens };
  }

  /** Пользователь по email или телефону (любое совпадение); `null` — нет такого. */
  private async _findUser(where: {
    email?: string;
    phone?: string;
  }): Promise<User | null> {
    try {
      return await this._userService.getUserByAttr(where);
    } catch (error) {
      if (error instanceof HttpException && error.status === 404) return null;
      throw error;
    }
  }

  private async _assertAccountPassword(user: User, password: string) {
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw AuthError.WRONG_PASSWORD();
    }
  }

  private async _sendResetMail(
    userId: string,
    email: string,
    locale?: string | null,
  ) {
    try {
      const issued = await this._resetPasswordTokensService.create(userId);

      if (issued) {
        await this._mailerService.sendResetPasswordMail(email, issued.token, {
          locale,
        });
      }
    } catch (err) {
      logger.error({ err, userId }, "[Auth] Reset password mail failed");
    }
  }
}
