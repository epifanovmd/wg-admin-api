import { LessThan } from "typeorm";

import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { AgentCommand } from "./agent-command.entity";

@InjectableRepository(AgentCommand)
export class AgentCommandRepository extends BaseRepository<AgentCommand> {
  findById(id: string): Promise<AgentCommand | null> {
    return this.findOneBy({ id });
  }

  /** Ждущие команды агента с `seq` больше `after` — по порядку. */
  findPending(agentId: string, after: number): Promise<AgentCommand[]> {
    return this.createQueryBuilder("c")
      .where("c.agent_id = :agentId", { agentId })
      .andWhere("c.status = 'pending'")
      .andWhere("c.seq > :after", { after })
      .orderBy("c.seq", "ASC")
      .limit(500)
      .getMany();
  }

  /** Последние команды агента (журнал), новые первыми. */
  findRecent(agentId: string, limit: number): Promise<AgentCommand[]> {
    return this.find({
      where: { agentId },
      order: { seq: "DESC" },
      take: limit,
    });
  }

  /**
   * Итог команды: только ждущей (повтор итога не меняет записанное). `true` — записан
   * сейчас.
   */
  async finish(
    id: string,
    ok: boolean,
    result: unknown,
    error: { code: string; message: string } | null,
  ): Promise<boolean> {
    const { affected } = await this.createQueryBuilder()
      .update()
      .set({
        status: "done",
        ok,
        result: (result === undefined ? null : result) as never,
        error,
        finishedAt: new Date(),
      })
      .where("id = :id", { id })
      .andWhere("status = 'pending'")
      .execute();

    return (affected ?? 0) > 0;
  }

  async setProgress(
    id: string,
    progress: number,
    text: string | null,
  ): Promise<void> {
    await this.update(
      { id, status: "pending" },
      { progress, progressText: text },
    );
  }

  async deleteFinishedBefore(date: Date): Promise<void> {
    await this.delete({ status: "done", finishedAt: LessThan(date) });
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.delete({ agentId });
  }
}
