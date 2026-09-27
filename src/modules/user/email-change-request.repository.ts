import { BaseRepository, InjectableRepository } from "../../core";
import { EmailChangeRequest } from "./email-change-request.entity";

/** Запросы на смену email. */
@InjectableRepository(EmailChangeRequest)
export class EmailChangeRequestRepository extends BaseRepository<EmailChangeRequest> {
  async findByUserId(userId: string): Promise<EmailChangeRequest | null> {
    return this.findOne({ where: { userId } });
  }

  /**
   * Засчитать неверный ввод атомарно, пока попыток меньше `max`.
   * Возвращает новое число попыток или `null` — лимит уже исчерпан
   * (или запрос удалён параллельно).
   */
  async incrementAttempts(id: string, max: number): Promise<number | null> {
    const result = await this.createQueryBuilder()
      .update(EmailChangeRequest)
      .set({ attempts: () => "attempts + 1" })
      .where("id = :id AND attempts < :max", { id, max })
      .returning(["attempts"])
      .execute();
    const row = (result.raw as { attempts: number }[] | undefined)?.[0];

    return result.affected && row ? row.attempts : null;
  }
}
