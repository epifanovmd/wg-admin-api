import { BaseRepository, InjectableRepository, Pagination } from "../../core";
import { Passkey } from "./passkey.entity";

/** Репозиторий для работы с passkey-учётными данными WebAuthn. */
@InjectableRepository(Passkey)
export class PasskeysRepository extends BaseRepository<Passkey> {
  /** Найти passkey по credential ID. */
  async findById(id: string): Promise<Passkey | null> {
    return this.findOne({ where: { id } });
  }

  /** Получить все passkeys пользователя. */
  async findByUserId(userId: string): Promise<Passkey[]> {
    return this.find({ where: { userId } });
  }

  /** Passkeys пользователя страницей, новые — первыми. */
  async findPageByUserId(
    userId: string,
    { offset, limit }: Pagination,
  ): Promise<[Passkey[], number]> {
    return this.findAndCount({
      where: { userId },
      order: { createdAt: "DESC", id: "ASC" },
      skip: offset,
      take: limit,
    });
  }

  /** Найти конкретный passkey по идентификатору пользователя и credential ID. */
  async findByUserIdAndId(userId: string, id: string): Promise<Passkey | null> {
    return this.findOne({ where: { userId, id } });
  }
}
