import { BaseRepository, InjectableRepository } from "../../core";
import { ResetPasswordTokens } from "./reset-password-tokens.entity";

/** Репозиторий токенов сброса пароля. */
@InjectableRepository(ResetPasswordTokens)
export class ResetPasswordTokensRepository extends BaseRepository<ResetPasswordTokens> {
  /** Токен пользователя (для cooldown повторной отправки). */
  async findByUserId(userId: string): Promise<ResetPasswordTokens | null> {
    return this.findOne({ where: { userId } });
  }

  /** Поиск по sha256 предъявленного токена. */
  async findByTokenHash(
    tokenHash: string,
  ): Promise<ResetPasswordTokens | null> {
    return this.findOne({ where: { tokenHash } });
  }
}
