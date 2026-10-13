import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { AgentConfig } from "./agent-config.entity";

@InjectableRepository(AgentConfig)
export class AgentConfigRepository extends BaseRepository<AgentConfig> {
  findOne3(
    agentId: string,
    worker: string,
    key: string,
  ): Promise<AgentConfig | null> {
    return this.findOneBy({ agentId, worker, key });
  }

  /** Все ключи агента (с удалёнными — `data = NULL`). */
  findByAgent(agentId: string): Promise<AgentConfig[]> {
    return this.find({
      where: { agentId },
      order: { worker: "ASC", key: "ASC" },
    });
  }

  /**
   * Записать значение (`NULL` — удалить): версия + 1 одним `UPSERT`. Вернуть новую версию.
   */
  async put(
    agentId: string,
    worker: string,
    key: string,
    data: unknown,
    actor: string | null,
  ): Promise<number> {
    const rows: Array<{ version: string }> = await this.query(
      `INSERT INTO agent_configs (agent_id, worker, key, version, data, actor, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, now())
       ON CONFLICT (agent_id, worker, key) DO UPDATE
         SET version = agent_configs.version + 1, data = EXCLUDED.data,
             actor = EXCLUDED.actor, updated_at = now()
       RETURNING version`,
      [
        agentId,
        worker,
        key,
        data === null ? null : JSON.stringify(data),
        actor,
      ],
    );

    return Number(rows[0].version);
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.delete({ agentId });
  }
}
