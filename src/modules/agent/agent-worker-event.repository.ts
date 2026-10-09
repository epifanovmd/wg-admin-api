import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { InjectableRepository } from "../../core";
import { BaseRepository } from "../../core/repository/repository";
import { AgentWorkerEvent } from "./agent-worker-event.entity";

/** Фильтр ленты событий: область агентов уже решена сервисом. */
export interface IAgentEventFilter {
  /** Только эти агенты; `undefined` — все. */
  agentIds?: string[];
  worker?: string;
  type?: string;
  /** Строго раньше этой точки `(receivedAt, id)` — следующая страница. */
  before?: { receivedAt: number; id: string };
  limit: number;
}

@InjectableRepository(AgentWorkerEvent)
export class AgentWorkerEventRepository extends BaseRepository<AgentWorkerEvent> {
  /** Сохранить, если такого (агент, id) ещё нет; `true` — событие новое. */
  async insertIfNew(event: AgentWorkerEvent): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .insert()
      // jsonb-поле `data` типизировано `unknown` — TypeORM его не выводит.
      .values(event as QueryDeepPartialEntity<AgentWorkerEvent>)
      .orIgnore()
      .returning(["id"])
      .execute();

    return result.raw.length > 0;
  }

  /** Лента «новые первыми». */
  findFeed(filter: IAgentEventFilter): Promise<AgentWorkerEvent[]> {
    const qb = this.createQueryBuilder("e");

    if (filter.agentIds) {
      if (filter.agentIds.length === 0) return Promise.resolve([]);
      qb.andWhere("e.agentId IN (:...agentIds)", {
        agentIds: filter.agentIds,
      });
    }
    if (filter.worker) qb.andWhere("e.worker = :worker", filter);
    if (filter.type) qb.andWhere("e.type = :type", filter);
    if (filter.before) {
      qb.andWhere("(e.receivedAt, e.id) < (:receivedAt, :id)", filter.before);
    }

    return qb
      .orderBy("e.receivedAt", "DESC")
      .addOrderBy("e.id", "DESC")
      .limit(filter.limit)
      .getMany();
  }

  /** Удалить принятые раньше; вернуть сколько удалено. */
  async deleteReceivedBefore(before: number): Promise<number> {
    const { affected } = await this.createQueryBuilder()
      .delete()
      .where("received_at < :before", { before })
      .execute();

    return affected ?? 0;
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.delete({ agentId });
  }
}
