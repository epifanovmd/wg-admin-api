import { LessThanOrEqual } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { Otp } from "./otp.entity";

/** Репозиторий одноразовых кодов (OTP). */
@InjectableRepository(Otp)
export class OtpRepository extends BaseRepository<Otp> {
  /** OTP-запись пользователя. */
  async findByUserId(userId: string): Promise<Otp | null> {
    return this.findOne({ where: { userId } });
  }

  /**
   * Атомарно увеличить счётчик неудачных попыток.
   * Возвращает новое значение или `null`, если записи уже нет.
   */
  async incrementAttempts(userId: string): Promise<number | null> {
    const result = await this.createQueryBuilder()
      .update(Otp)
      .set({ attempts: () => "attempts + 1" })
      .where("user_id = :userId", { userId })
      .returning(["attempts"])
      .execute();
    const row = (result.raw as { attempts: number }[])[0];

    return row ? Number(row.attempts) : null;
  }

  /** Удалить просроченные коды; возвращает число удалённых. */
  async deleteExpired(): Promise<number> {
    const { affected } = await this.delete({
      expireAt: LessThanOrEqual(new Date()),
    });

    return affected ?? 0;
  }
}
