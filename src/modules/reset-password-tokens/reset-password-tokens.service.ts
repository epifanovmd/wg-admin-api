import { randomBytes } from "crypto";
import { inject } from "inversify";

import { config } from "../../config";
import { hashToken, Injectable } from "../../core";
import { ResetPasswordError } from "./reset-password-tokens.errors";
import { ResetPasswordTokensRepository } from "./reset-password-tokens.repository";

const {
  auth: { resetPassword },
} = config;

const TOKEN_BYTES = 32;
const MS_IN_MINUTE = 60_000;

/** Не чаще одного письма в минуту на пользователя. */
export const RESET_RESEND_COOLDOWN_MS = 60_000;

/**
 * Токены сброса пароля: случайная строка без структуры (не JWT),
 * в БД — только sha256, поиск по хешу, одноразовое использование.
 */
@Injectable()
export class ResetPasswordTokensService {
  constructor(
    @inject(ResetPasswordTokensRepository)
    private _resetPasswordTokensRepository: ResetPasswordTokensRepository,
  ) {}

  /**
   * Выпустить новый токен (прежний перестаёт действовать).
   * `null` — предыдущий выпущен меньше минуты назад, письмо слать не нужно.
   */
  async create(userId: string): Promise<{ token: string } | null> {
    const existing =
      await this._resetPasswordTokensRepository.findByUserId(userId);

    if (
      existing &&
      Date.now() - existing.issuedAt.getTime() < RESET_RESEND_COOLDOWN_MS
    ) {
      return null;
    }

    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    await this._resetPasswordTokensRepository.upsert(
      {
        userId,
        tokenHash: hashToken(token),
        issuedAt: new Date(),
        expiresAt: new Date(
          Date.now() + resetPassword.expireMinutes * MS_IN_MINUTE,
        ),
      },
      ["userId"],
    );

    return { token };
  }

  /**
   * Проверить токен, не погашая его: чей он. Нужен, чтобы проверить новый
   * пароль до того, как токен будет израсходован.
   */
  async peek(token: string): Promise<{ userId: string }> {
    const record = await this._resetPasswordTokensRepository.findByTokenHash(
      hashToken(token),
    );

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw ResetPasswordError.TOKEN_INVALID();
    }

    return { userId: record.userId };
  }

  /**
   * Проверить и погасить токен. Удаление по условию — из двух
   * одновременных запросов с одним токеном пройдёт только один.
   */
  async check(token: string): Promise<{ userId: string }> {
    const tokenHash = hashToken(token);
    const record =
      await this._resetPasswordTokensRepository.findByTokenHash(tokenHash);

    if (!record) {
      throw ResetPasswordError.TOKEN_INVALID();
    }

    const { affected } = await this._resetPasswordTokensRepository.delete({
      userId: record.userId,
      tokenHash,
    });

    if (affected !== 1 || record.expiresAt.getTime() <= Date.now()) {
      throw ResetPasswordError.TOKEN_INVALID();
    }

    return { userId: record.userId };
  }
}
