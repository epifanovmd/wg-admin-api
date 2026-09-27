import { LessThan, MoreThan } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { PasskeyChallenge } from "./passkey-challenge.entity";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 минут

@InjectableRepository(PasskeyChallenge)
export class PasskeyChallengeRepository extends BaseRepository<PasskeyChallenge> {
  async createChallenge(
    userId: string,
    challenge: string,
  ): Promise<PasskeyChallenge> {
    return this.createAndSave({
      userId,
      challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  }

  /**
   * Погасить challenge: удалить ровно подписанный клиентом, если он ещё
   * действует. `true` — погашен этим вызовом; повтор и параллельный запрос
   * получают `false` — challenge одноразовый.
   */
  async consumeChallenge(userId: string, challenge: string): Promise<boolean> {
    const { affected } = await this.delete({
      userId,
      challenge,
      expiresAt: MoreThan(new Date()),
    });

    return (affected ?? 0) > 0;
  }

  /** Удалить просроченные challenge; возвращает число удалённых. */
  async deleteExpired(): Promise<number> {
    const { affected } = await this.delete({ expiresAt: LessThan(new Date()) });

    return affected ?? 0;
  }
}
