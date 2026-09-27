import { BaseRepository, InjectableRepository, Pagination } from "../../core";
import { Profile } from "./profile.entity";

/** Репозиторий для работы с профилями пользователей. */
@InjectableRepository(Profile)
export class ProfileRepository extends BaseRepository<Profile> {
  /** Найти профиль по ID, подгружая пользователя. */
  async findById(id: string) {
    return this.findOne({
      where: { id },
      relations: { user: true },
    });
  }

  /** Найти профиль по идентификатору пользователя, подгружая пользователя. */
  async findByUserId(userId: string) {
    return this.findOne({
      where: { userId },
      relations: { user: true },
    });
  }

  /** Страница профилей с пользователями, новые первыми. */
  async findPage({ offset, limit }: Pagination): Promise<[Profile[], number]> {
    return this.createQueryBuilder("profile")
      .leftJoinAndSelect("profile.user", "user")
      .orderBy("profile.createdAt", "DESC")
      .skip(offset)
      .take(limit)
      .getManyAndCount();
  }
}
