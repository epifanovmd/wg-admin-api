import { createVerify, randomBytes } from "crypto";
import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { AuthService } from "../auth";
import { IDeviceInfo } from "../session";
import { UserService } from "../user";
import { BiometricError } from "./biometric.errors";
import { BiometricRepository } from "./biometric.repository";
import { BiometricAddedEvent, BiometricRemovedEvent } from "./events";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_DEVICES_PER_USER = 5;

export interface IVerifyBiometricPayload {
  userId: string;
  deviceId: string;
  nonce: string;
  signature: string;
}

/** Проверка RSA-SHA256 подписи; битый ключ или подпись — просто «не совпало». */
const verifySignature = (
  publicKeyBase64: string,
  message: string,
  signature: string,
): boolean => {
  const body = Buffer.from(publicKeyBase64, "base64")
    .toString("base64")
    .match(/.{1,64}/g)
    ?.join("\n");
  const pem = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;

  try {
    return createVerify("SHA256")
      .update(message)
      .end()
      .verify(pem, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
};

/**
 * Вход по биометрии: устройство регистрирует публичный ключ, затем
 * подписывает одноразовый nonce. Верная подпись открывает новую сессию.
 */
@Injectable()
export class BiometricService {
  constructor(
    @inject(UserService) private _userService: UserService,
    @inject(BiometricRepository)
    private _biometricRepository: BiometricRepository,
    @inject(AuthService) private _authService: AuthService,
    @inject(EventBus) private _eventBus: EventBus,
  ) {}

  /** Зарегистрировать (или перерегистрировать) ключ устройства. */
  async registerBiometric(
    userId: string,
    deviceId: string,
    deviceName: string,
    publicKey: string,
  ) {
    const existing = await this._biometricRepository.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    if (existing) {
      existing.publicKey = publicKey;
      existing.deviceName = deviceName;
      existing.challenge = null;
      existing.challengeExpiresAt = null;
      existing.lastUsedAt = new Date();
      await this._biometricRepository.save(existing);
      this._eventBus.emit(
        new BiometricAddedEvent(userId, deviceId, deviceName),
      );

      return;
    }

    const count = await this._biometricRepository.countByUserId(userId);

    if (count >= MAX_DEVICES_PER_USER) {
      throw BiometricError.DEVICE_LIMIT(
        { max: MAX_DEVICES_PER_USER },
        `Достигнут лимит устройств (макс. ${MAX_DEVICES_PER_USER})`,
      );
    }

    await this._biometricRepository.createAndSave({
      userId,
      deviceId,
      deviceName,
      publicKey,
      lastUsedAt: new Date(),
    });

    this._eventBus.emit(new BiometricAddedEvent(userId, deviceId, deviceName));
  }

  /**
   * Выдать nonce для подписи. Для незарегистрированного устройства ответ
   * такой же, но nonce нигде не сохраняется — наличие устройства не раскрывается.
   */
  async generateNonce(userId: string, deviceId: string) {
    const nonce = randomBytes(32).toString("base64url");
    const biometric = await this._biometricRepository.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    if (biometric) {
      biometric.challenge = nonce;
      biometric.challengeExpiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
      await this._biometricRepository.save(biometric);
    }

    return { nonce };
  }

  /**
   * Проверить подпись nonce и открыть сессию. Nonce гасится атомарно до
   * проверки подписи: одна попытка на nonce, повтор — 401.
   */
  async verifyBiometricSignature(
    { userId, deviceId, nonce, signature }: IVerifyBiometricPayload,
    deviceInfo: IDeviceInfo = {},
  ) {
    const biometric = await this._biometricRepository.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    if (
      !biometric ||
      biometric.challenge !== nonce ||
      !biometric.challengeExpiresAt ||
      biometric.challengeExpiresAt.getTime() <= Date.now()
    ) {
      throw BiometricError.VERIFY_FAILED();
    }

    if (
      !(await this._biometricRepository.consumeChallenge(biometric.id, nonce))
    ) {
      throw BiometricError.VERIFY_FAILED();
    }

    if (!verifySignature(biometric.publicKey, nonce, signature)) {
      throw BiometricError.VERIFY_FAILED();
    }

    const user = await this._userService.getUser(userId);
    const { tokens } = await this._authService.completeLogin(
      user,
      {
        ...deviceInfo,
        deviceName: deviceInfo.deviceName ?? biometric.deviceName ?? deviceId,
      },
      "biometric",
    );

    await this._biometricRepository.update(biometric.id, {
      lastUsedAt: new Date(),
    });

    return { verified: true, tokens };
  }

  async getDevices(userId: string) {
    return this._biometricRepository.findByUserId(userId);
  }

  /** Удалить своё устройство; несуществующее — 404. */
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this._biometricRepository.deleteByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    if (!result.affected) {
      throw BiometricError.DEVICE_NOT_FOUND();
    }

    this._eventBus.emit(new BiometricRemovedEvent(userId, deviceId));
  }
}
