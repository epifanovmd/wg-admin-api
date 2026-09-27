import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createHmac } from "crypto";
import { inject } from "inversify";

import { normalizePhone } from "../../common";
import { config } from "../../config";
import {
  EventBus,
  HttpException,
  Injectable,
  IPaginatedDto,
  isUniqueViolation,
  logger,
  normalizePagination,
  toPage,
} from "../../core";
import { AuthService } from "../auth";
import { IDeviceInfo } from "../session";
import { UserService } from "../user";
import { PasskeyAddedEvent, PasskeyRemovedEvent } from "./events";
import { PasskeyChallengeRepository } from "./passkey-challenge.repository";
import { PasskeyDto } from "./passkeys.dto";
import { PasskeyError } from "./passkeys.errors";
import { PasskeysRepository } from "./passkeys.repository";

const { webAuthn } = config.auth;
const rpName = webAuthn.rpName;
const rpID = webAuthn.rpHost;
const port = webAuthn.rpPort ? `:${webAuthn.rpPort}` : "";
const origin = `${webAuthn.rpSchema}://${rpID}${port}`;

/**
 * Фиктивный, но стабильный credential id для логина без passkey: ответ
 * неотличим от настоящего, по нему нельзя узнать, есть ли аккаунт или ключ.
 */
/**
 * Challenge, который подписал клиент (из `clientDataJSON`). Проверяется и
 * гасится именно он, а не «последний» challenge пользователя: параметры
 * входа выдаются без авторизации, и чужой запрос не должен срывать вход.
 */
const signedChallenge = (
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): string | null => {
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString(
        "utf8",
      ),
    ) as { challenge?: unknown };

    return typeof clientData.challenge === "string" &&
      clientData.challenge.length > 0
      ? clientData.challenge
      : null;
  } catch {
    return null;
  }
};

const decoyCredentialId = (login: string): string =>
  createHmac("sha256", config.auth.jwt.secretKey)
    .update(`passkey-decoy:${login.toLowerCase()}`)
    .digest("base64url");

/** Сервис для регистрации и аутентификации через WebAuthn passkeys. */
@Injectable()
export class PasskeysService {
  constructor(
    @inject(UserService) private _userService: UserService,
    @inject(PasskeysRepository) private _passkeysRepository: PasskeysRepository,
    @inject(PasskeyChallengeRepository)
    private _challengeRepo: PasskeyChallengeRepository,
    @inject(AuthService) private _authService: AuthService,
    @inject(EventBus) private _eventBus: EventBus,
  ) {}

  /**
   * Генерирует параметры для регистрации passkey.
   * Вызывается авторизованным пользователем.
   */
  async generateRegistrationOptions(userId: string) {
    const user = await this._userService.getUser(userId);
    const userName = user.email || user.phone;

    if (!userName) {
      throw PasskeyError.LOGIN_REQUIRED();
    }

    const existingPasskeys =
      await this._passkeysRepository.findByUserId(userId);
    const userIdBuffer = Buffer.from(user.id, "utf-8");

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: userIdBuffer,
      userName,
      userDisplayName: userName,
      attestationType: "none",
      excludeCredentials: existingPasskeys.map(p => ({
        id: p.id,
        transports: p.transports,
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        requireResidentKey: false,
        residentKey: "discouraged",
      },
      timeout: 60000,
    });

    await this._challengeRepo.createChallenge(user.id, options.challenge);

    return options;
  }

  /**
   * Верифицирует ответ регистрации и сохраняет passkey.
   * Вызывается авторизованным пользователем.
   */
  async verifyRegistration(userId: string, data: RegistrationResponseJSON) {
    if (data?.id && (await this._passkeysRepository.findById(data.id))) {
      throw PasskeyError.ALREADY_REGISTERED();
    }

    // Challenge гасится до проверки подписи: одна попытка на challenge,
    // повтор того же ответа (в том числе параллельный) не пройдёт.
    const challenge = data ? signedChallenge(data) : null;

    if (
      !challenge ||
      !(await this._challengeRepo.consumeChallenge(userId, challenge))
    ) {
      throw PasskeyError.CHALLENGE_MISSING();
    }

    let verification;

    try {
      verification = await verifyRegistrationResponse({
        response: data,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (error) {
      logger.debug({ err: error, userId }, "[Passkeys] Registration rejected");
      throw PasskeyError.REGISTRATION_FAILED();
    }

    if (verification.verified && verification.registrationInfo) {
      const { credential, credentialDeviceType } =
        verification.registrationInfo;

      try {
        await this._passkeysRepository.createAndSave({
          id: credential.id,
          publicKey: new Uint8Array(credential.publicKey),
          userId,
          counter: credential.counter,
          deviceType: credentialDeviceType,
          transports: credential.transports,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw PasskeyError.ALREADY_REGISTERED();
        throw error;
      }

      this._eventBus.emit(new PasskeyAddedEvent(userId, credential.id));
    }

    return { verified: verification.verified };
  }

  /**
   * Генерирует параметры для аутентификации по passkey.
   * Принимает login (email или телефон) для поиска пользователя.
   */
  async generateAuthenticationOptions(login: string) {
    const value = login.trim();
    let userId: string | undefined;

    try {
      const user = await this._userService.getUserByAttr(
        value.includes("@")
          ? { email: value.toLowerCase() }
          : { phone: normalizePhone(value) },
      );

      userId = user.id;
    } catch (error) {
      if (!(error instanceof HttpException && error.status === 404)) {
        throw error;
      }
    }

    const passkeys = userId
      ? await this._passkeysRepository.findByUserId(userId)
      : [];

    // Нет пользователя или ключей — отвечаем так же, как при наличии:
    // вход всё равно не пройдёт, а существование аккаунта не раскрывается.
    if (!userId || passkeys.length === 0) {
      return generateAuthenticationOptions({
        rpID,
        allowCredentials: [{ id: decoyCredentialId(value) }],
        timeout: 60000,
      });
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map(p => ({
        id: p.id,
        transports: p.transports,
      })),
      timeout: 60000,
    });

    await this._challengeRepo.createChallenge(userId, options.challenge);

    return options;
  }

  /**
   * Верифицирует ответ аутентификации и открывает сессию с данными устройства.
   * Любой провал — 401 с одинаковым сообщением.
   */
  async verifyAuthentication(
    data: AuthenticationResponseJSON,
    deviceInfo: IDeviceInfo = {},
  ) {
    const passkey = data?.id
      ? await this._passkeysRepository.findById(data.id)
      : null;

    if (!passkey) {
      throw PasskeyError.AUTH_FAILED();
    }

    // Гасится до проверки подписи — как nonce биометрии: повтор ответа
    // (счётчик у passkey платформ всегда 0 и от него не защищает) — 401.
    const challenge = signedChallenge(data);

    if (
      !challenge ||
      !(await this._challengeRepo.consumeChallenge(passkey.userId, challenge))
    ) {
      throw PasskeyError.AUTH_FAILED(
        undefined,
        "Challenge не найден, истёк или уже использован. Запросите параметры входа заново.",
      );
    }

    let verifyData;

    try {
      verifyData = await verifyAuthenticationResponse({
        response: data,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          // bytea приходит Buffer'ом; библиотеке нужен Uint8Array над ArrayBuffer.
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports,
        },
      });
    } catch (error) {
      logger.debug(
        { err: error, userId: passkey.userId },
        "[Passkeys] Authentication rejected",
      );
      throw PasskeyError.AUTH_FAILED();
    }

    if (!verifyData.verified) {
      throw PasskeyError.AUTH_FAILED();
    }

    await this._passkeysRepository.update(passkey.id, {
      counter: verifyData.authenticationInfo.newCounter,
      lastUsed: new Date(),
    });

    const user = await this._userService.getUser(passkey.userId);
    const { tokens } = await this._authService.completeLogin(
      user,
      { ...deviceInfo, deviceName: deviceInfo.deviceName ?? "passkey" },
      "passkey",
    );

    return { verified: true, tokens };
  }

  /** Passkeys пользователя страницей. */
  async getPasskeys(
    userId: string,
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<PasskeyDto>> {
    const page = normalizePagination(offset, limit);
    const [passkeys, total] = await this._passkeysRepository.findPageByUserId(
      userId,
      page,
    );

    return toPage(passkeys.map(PasskeyDto.fromEntity), total, page);
  }

  /** Удалить свой passkey; чужой или несуществующий — 404. */
  async deletePasskey(userId: string, id: string): Promise<void> {
    const { affected } = await this._passkeysRepository.delete({ id, userId });

    if (!affected) {
      throw PasskeyError.NOT_FOUND();
    }

    this._eventBus.emit(new PasskeyRemovedEvent(userId, id));
  }

  /** Удалить просроченные challenge (фоновая очистка). */
  cleanupExpiredChallenges(): Promise<number> {
    return this._challengeRepo.deleteExpired();
  }
}
