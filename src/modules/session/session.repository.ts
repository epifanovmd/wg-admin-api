import { In, LessThanOrEqual, MoreThan } from "typeorm";

import { InjectableRepository, Pagination } from "../../core";
import { BaseRepository } from "../../core/repository/repository";
import { Session } from "./session.entity";

@InjectableRepository(Session)
export class SessionRepository extends BaseRepository<Session> {
  /** Действующие сессии пользователя страницей, последние активные — первыми. */
  async findActiveByUserId(
    userId: string,
    { offset, limit }: Pagination,
  ): Promise<[Session[], number]> {
    return this.findAndCount({
      where: { userId, expiresAt: MoreThan(new Date()) },
      order: { lastActiveAt: "DESC", id: "ASC" },
      skip: offset,
      take: limit,
    });
  }

  async findById(id: string) {
    return this.findOne({ where: { id } });
  }

  /**
   * Атомарная ротация: хеш меняется, только если в БД всё ещё `oldHash`.
   * `false` — токен уже ротирован параллельным запросом или сессия удалена.
   */
  async rotateRefreshToken(
    id: string,
    oldHash: string,
    newHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { affected } = await this.update(
      { id, refreshTokenHash: oldHash },
      { refreshTokenHash: newHash, expiresAt, lastActiveAt: new Date() },
    );

    return affected === 1;
  }

  /** Сессии пользователя сверх `keep` самых новых — кандидаты на вытеснение. */
  async findIdsBeyondLimit(userId: string, keep: number): Promise<string[]> {
    const rows = await this.find({
      where: { userId },
      select: { id: true },
      order: { createdAt: "DESC" },
      skip: keep,
    });

    return rows.map(row => row.id);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length) await this.delete({ id: In(ids) });
  }

  /** Удалить просроченные сессии; возвращает число удалённых. */
  async deleteExpired(): Promise<number> {
    const { affected } = await this.delete({
      expiresAt: LessThanOrEqual(new Date()),
    });

    return affected ?? 0;
  }
}
