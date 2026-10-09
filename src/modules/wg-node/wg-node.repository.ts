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
   * Поднять желаемую версию конфигурации ноды — после коммита она уходит
   * воркеру wg агента (сигнал `wg_node_changed`). Вызывается в транзакции
   * изменения домена.
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

  /** Нода агента. */
  findByAgentId(agentId: string): Promise<WgNode | null> {
    return this.findOne({ where: { agentId } });
  }

  /** Агенты нод: всех или своих (владелец или создатель). */
  async findAgentIds(ownedBy?: string): Promise<string[]> {
    const qb = this.createQueryBuilder("node")
      .select("node.agentId", "agentId")
      .where("node.agentId IS NOT NULL");

    if (ownedBy) qb.andWhere(WgNodeAccess.ownedCondition("node"), { ownedBy });

    return (await qb.getRawMany<{ agentId: string }>()).map(row => row.agentId);
  }

  /** Ноды с агентами: id ноды и агента. */
  async findBound(): Promise<Array<{ id: string; agentId: string }>> {
    const rows = await this.createQueryBuilder("node")
      .select(["node.id AS id", 'node.agentId AS "agentId"'])
      .where("node.agentId IS NOT NULL")
      .getRawMany<{ id: string; agentId: string }>();

    return rows;
  }

  /** Отвязать агента от ноды, где он был; возвращает id ноды. */
  async clearAgent(agentId: string): Promise<string | null> {
    const result = await this.createQueryBuilder()
      .update(WgNode)
      .set({
        agentId: null,
        status: EWgNodeStatus.Created,
        statusMessage: null,
      })
      .where("agent_id = :agentId", { agentId })
      .returning(["id"])
      .execute();

    return ((result.raw as { id: string }[]) ?? [])[0]?.id ?? null;
  }

  private _withOwners() {
    const qb = this.createQueryBuilder("node");

    joinUserName(qb, "node.owner", "owner");
    joinUserName(qb, "node.createdBy", "createdBy");

    return qb;
  }
}
