import { LessThan } from "typeorm";

import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { AgentEvent } from "./agent-event.entity";

export interface IAgentEventFilter {
  agentId?: string;
  agentIds?: string[];
  worker?: string;
  type?: string;
  /** Курсор: `receivedAt` и `id` последнего на прошлой странице. */
  before?: { receivedAt: number; id: string };
  limit: number;
}

@InjectableRepository(AgentEvent)
export class AgentEventRepository extends BaseRepository<AgentEvent> {
  /** Записать, если такого id у агента ещё нет; `true` — событие новое. */
  async insertIfNew(event: AgentEvent): Promise<boolean> {
    const rows: unknown[] = await this.query(
      `INSERT INTO agent_events (agent_id, id, worker, type, data, problems, at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
      [
        event.agentId,
        event.id,
        event.worker,
        event.type,
        event.data === null || event.data === undefined
          ? null
          : JSON.stringify(event.data),
        event.problems?.length ? JSON.stringify(event.problems) : null,
        event.at,
        event.receivedAt,
      ],
    );

    return rows.length > 0;
  }

  findFeed(filter: IAgentEventFilter): Promise<AgentEvent[]> {
    const qb = this.createQueryBuilder("e");

    if (filter.agentId)
      qb.andWhere("e.agent_id = :agentId", { agentId: filter.agentId });
    if (filter.agentIds)
      qb.andWhere("e.agent_id IN (:...ids)", {
        ids: filter.agentIds.length ? filter.agentIds : [""],
      });
    if (filter.worker)
      qb.andWhere("e.worker = :worker", { worker: filter.worker });
    if (filter.type) qb.andWhere("e.type = :type", { type: filter.type });
    if (filter.before) {
      qb.andWhere("(e.received_at, e.id) < (:at, :id)", {
        at: filter.before.receivedAt,
        id: filter.before.id,
      });
    }

    return qb
      .orderBy("e.received_at", "DESC")
      .addOrderBy("e.id", "DESC")
      .limit(filter.limit)
      .getMany();
  }

  async deleteReceivedBefore(at: number): Promise<void> {
    await this.delete({ receivedAt: LessThan(at) });
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.delete({ agentId });
  }
}
