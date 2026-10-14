import { InjectableRepository } from "../decorators";
import { BaseRepository } from "../repository";
import { AgentIssue } from "./agent-issue.entity";

@InjectableRepository(AgentIssue)
export class AgentIssueRepository extends BaseRepository<AgentIssue> {
  /**
   * Занять ссылку одним условным `UPDATE`: не скачана и не истекла. `null` — ссылки нет, она
   * уже скачана или истекла (в том числе при одновременном скачивании).
   */
  async claim(id: string, now: Date): Promise<AgentIssue | null> {
    const { affected } = await this.createQueryBuilder()
      .update()
      .set({ downloadedAt: now })
      .where("id = :id", { id })
      .andWhere("downloaded_at IS NULL")
      .andWhere("expires_at > :now", { now })
      .execute();

    return affected ? this.findOneBy({ id }) : null;
  }

  /** Вернуть ссылку (архив не собрался): снова можно скачать. */
  async release(id: string): Promise<void> {
    await this.update({ id }, { downloadedAt: null });
  }

  async setToken(id: string, tokenId: string): Promise<void> {
    await this.update({ id }, { tokenId });
  }
}
