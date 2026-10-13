import { Between, LessThan } from "typeorm";

import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { AgentMetric } from "./agent-metric.entity";

@InjectableRepository(AgentMetric)
export class AgentMetricRepository extends BaseRepository<AgentMetric> {
  findRange(
    agentId: string,
    since: number,
    until: number,
    limit: number,
  ): Promise<AgentMetric[]> {
    return this.find({
      where: { agentId, at: Between(since, until) },
      order: { at: "DESC" },
      take: limit,
    }).then(rows => rows.reverse());
  }

  async findLastAt(agentId: string): Promise<number | null> {
    const row = await this.findOne({
      where: { agentId },
      order: { at: "DESC" },
    });

    return row?.at ?? null;
  }

  async deleteBefore(at: number): Promise<void> {
    await this.delete({ at: LessThan(at) });
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.delete({ agentId });
  }
}
