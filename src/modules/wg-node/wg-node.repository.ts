import type { EntityManager } from "typeorm";

import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { joinUserName } from "../user/user-name";
import { WgNodeAccess } from "./wg-node.access";
import { WgNode } from "./wg-node.entity";
import { EWgNodeStatus } from "./wg-node.types";

export interface IWgNodeFilters {
  query?: string;
  status?: EWgNodeStatus;
  /** Только свои ноды пользователя: владелец или создатель. */
  ownedBy?: string;
}

@InjectableRepository(WgNode)
export class WgNodeRepository extends BaseRepository<WgNode> {
  findPage(
    { query, status, ownedBy }: IWgNodeFilters,
    { offset, limit }: Pagination,
  ): Promise<[WgNode[], number]> {
    const qb = this._withOwners()
      .orderBy("node.createdAt", "DESC")
      .addOrderBy("node.id", "DESC")
      .skip(offset)
      .take(limit);

    if (status) qb.andWhere("node.status = :status", { status });
    if (ownedBy) qb.andWhere(WgNodeAccess.ownedCondition("node"), { ownedBy });
    if (query) {
      qb.andWhere("(node.name ILIKE :query OR node.publicHost ILIKE :query)", {
        query: `%${query}%`,
      });
    }

    return qb.getManyAndCount();
  }

  /** Нода с именами владельца и создателя. */
  findWithOwners(id: string): Promise<WgNode | null> {
    return this._withOwners().where("node.id = :id", { id }).getOne();
  }

  /** Ноды с именами владельца и создателя. */
  findManyWithOwners(ids: string[]): Promise<WgNode[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this._withOwners().where("node.id IN (:...ids)", { ids }).getMany();
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

  private _withOwners() {
    const qb = this.createQueryBuilder("node");

    joinUserName(qb, "node.owner", "owner");
    joinUserName(qb, "node.createdBy", "createdBy");

    return qb;
  }
}
