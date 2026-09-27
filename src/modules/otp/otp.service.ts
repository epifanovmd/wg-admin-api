import { inject } from "inversify";

import { generateOtp } from "../../common";
import { config } from "../../config";
import { Injectable } from "../../core";
import { OtpError } from "./otp.errors";
import { OtpRepository } from "./otp.repository";

const {
  auth: { otp },
} = config;

const MS_IN_MINUTE = 60_000;

/** Сколько неверных вводов допускает один код; после — код удаляется. */
export const OTP_MAX_ATTEMPTS = 5;

/** Минимальный интервал между отправками кода одному пользователю. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/** Генерация и одноразовая проверка OTP-кодов. */
@Injectable()
export class OtpService {
  constructor(@inject(OtpRepository) private _otpRepository: OtpRepository) {}

  /** Выпустить новый код (прежний перестаёт действовать); не чаще раза в минуту. */
  async create(userId: string): Promise<{ code: string; expireAt: Date }> {
    const existing = await this._otpRepository.findByUserId(userId);

    if (
      existing &&
      Date.now() - existing.sentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw OtpError.RESEND_COOLDOWN();
    }

    const code = generateOtp();
    const expireAt = new Date(Date.now() + otp.expireMinutes * MS_IN_MINUTE);

    await this._otpRepository.upsert(
      { userId, code, expireAt, attempts: 0, sentAt: new Date() },
      ["userId"],
    );

    return { code, expireAt };
  }

  /**
   * Проверить и погасить код. Неверный ввод расходует попытку; истёкший или
   * исчерпанный код удаляется. Удаление по условию — из двух одновременных
   * проверок одного кода пройдёт только одна.
   */
  async check(userId: string, code: string): Promise<true> {
    const record = await this._otpRepository.findByUserId(userId);

    if (!record) {
      throw OtpError.INVALID_CODE();
    }

    if (record.expireAt.getTime() <= Date.now()) {
      await this._otpRepository.delete({ userId });
      throw OtpError.CODE_EXPIRED();
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this._otpRepository.delete({ userId });
      throw OtpError.ATTEMPTS_EXHAUSTED();
    }

    if (record.code !== code) {
      const attempts = await this._otpRepository.incrementAttempts(userId);

      if (attempts !== null && attempts >= OTP_MAX_ATTEMPTS) {
        await this._otpRepository.delete({ userId });
        throw OtpError.ATTEMPTS_EXHAUSTED();
      }

      throw OtpError.INVALID_CODE();
    }

    const { affected } = await this._otpRepository.delete({ userId, code });

    if (affected !== 1) {
      throw OtpError.INVALID_CODE();
    }

    return true;
  }
}
