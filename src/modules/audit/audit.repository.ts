import { LessThan } from "typeorm";

import { BaseRepository, InjectableRepository } from "../../core";
import { IAuditFilter } from "./audit.types";
import { AuditEvent } from "./audit-event.entity";

/** Позиция в ленте: последнее прочитанное событие. */
export interface IAuditCursor {
  createdAt: Date;
  id: string;
}

@InjectableRepository(AuditEvent)
export class AuditRepository extends BaseRepository<AuditEvent> {
  /**
   * Лента событий, новые — первыми; `limit + 1` строка — чтобы понять,
   * есть ли следующая страница.
   */
  async findFeed(
    filter: IAuditFilter,
    limit: number,
    after?: IAuditCursor,
  ): Promise<AuditEvent[]> {
    const qb = this.createQueryBuilder("e")
      .orderBy("e.createdAt", "DESC")
      .addOrderBy("e.id", "DESC")
      .limit(limit + 1);

    if (filter.actorId) {
      qb.andWhere("e.actor_id = :actorId", { actorId: filter.actorId });
    }

    if (filter.type) {
      qb.andWhere("e.type = :type", { type: filter.type });
    }

    if (after) {
      qb.andWhere(
        "(e.created_at < :createdAt OR (e.created_at = :createdAt AND e.id < :id))",
        { createdAt: after.createdAt, id: after.id },
      );
    }

    return qb.getMany();
  }

  /** Удалить события старше даты; возвращает число удалённых. */
  async deleteOlderThan(date: Date): Promise<number> {
    const { affected } = await this.delete({ createdAt: LessThan(date) });

    return affected ?? 0;
  }
}
