import type { EntityManager } from "typeorm";

import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { WgNode } from "./wg-node.entity";
import { EWgNodeStatus } from "./wg-node.types";

export interface IWgNodeFilters {
  query?: string;
  status?: EWgNodeStatus;
}

@InjectableRepository(WgNode)
export class WgNodeRepository extends BaseRepository<WgNode> {
  findPage(
    { query, status }: IWgNodeFilters,
    { offset, limit }: Pagination,
  ): Promise<[WgNode[], number]> {
    const qb = this.createQueryBuilder("node")
      .orderBy("node.createdAt", "DESC")
      .addOrderBy("node.id", "DESC")
      .skip(offset)
      .take(limit);

    if (status) qb.andWhere("node.status = :status", { status });
    if (query) {
      qb.andWhere("(node.name ILIKE :query OR node.publicHost ILIKE :query)", {
        query: `%${query}%`,
      });
    }

    return qb.getManyAndCount();
  }

  /**
   * Поднять желаемую версию конфигурации ноды — агент увидит изменение в
   * ближайший long-poll. Вызывается в транзакции изменения домена.
   */
  async markDirty(nodeId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? this.getRepository(manager) : this;

    await repo.increment({ id: nodeId }, "configVersion", 1);
  }

  async markDirtyMany(
    nodeIds: string[],
    manager?: EntityManager,
  ): Promise<void> {
    for (const nodeId of new Set(nodeIds)) {
      await this.markDirty(nodeId, manager);
    }
  }

  /** Ноды, чей агент молчит дольше порога, — в offline; возвращает изменённые. */
  async markSilentOffline(
    silentSince: Date,
    nodeId?: string,
  ): Promise<string[]> {
    const query = this.createQueryBuilder()
      .update(WgNode)
      .set({ status: EWgNodeStatus.Offline })
      .where("status = :online", { online: EWgNodeStatus.Online })
      .andWhere("(last_seen_at IS NULL OR last_seen_at < :silentSince)", {
        silentSince,
      });

    if (nodeId) query.andWhere("id = :nodeId", { nodeId });

    const result = await query.returning(["id"]).execute();

    return ((result.raw as { id: string }[]) ?? []).map(row => row.id);
  }
}
