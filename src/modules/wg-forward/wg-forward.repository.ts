import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { joinUserName } from "../user/user-name";
import { WgForwardAccess } from "./wg-forward.access";
import { WgForward } from "./wg-forward.entity";
import { EWgForwardProtocol } from "./wg-forward.types";

@InjectableRepository(WgForward)
export class WgForwardRepository extends BaseRepository<WgForward> {
  /** Страница пробросов; `ownedBy` — только свои (владелец или создатель). */
  findPage(
    { offset, limit }: Pagination,
    ownedBy?: string,
  ): Promise<[WgForward[], number]> {
    const qb = this._withRelations()
      .orderBy("forward.createdAt", "DESC")
      .addOrderBy("forward.id", "DESC")
      .skip(offset)
      .take(limit);

    if (ownedBy) {
      qb.andWhere(WgForwardAccess.ownedCondition("forward"), { ownedBy });
    }

    return qb.getManyAndCount();
  }

  /** Проброс с нодами и именами владельца и создателя. */
  findWithNodes(id: string): Promise<WgForward | null> {
    return this._withRelations().where("forward.id = :id", { id }).getOne();
  }

  /** Включённые пробросы релея — для его desired state. */
  findActiveByRelay(relayNodeId: string): Promise<WgForward[]> {
    return this.find({
      where: { relayNodeId, enabled: true },
      relations: { targetNode: true },
    });
  }

  /** Ноды — цели IPIP-пробросов релея (им нужен линк с туннелем). */
  async ipipTargetsOfRelay(relayNodeId: string): Promise<string[]> {
    const rows: Array<{ nodeId: string }> = await this.createQueryBuilder("f")
      .select("DISTINCT f.target_node_id", "nodeId")
      .where("f.relay_node_id = :relayNodeId", { relayNodeId })
      .andWhere("f.path = 'ipip'")
      .andWhere("f.enabled = true")
      .andWhere("f.target_node_id IS NOT NULL")
      .getRawMany();

    return rows.map(row => row.nodeId);
  }

  /**
   * Порты, которые пробросы занимают на ноде (она — релей). Выключенный
   * проброс порт не держит: интерфейс можно перевести на точку через релей,
   * а проброс оставить для отката — включить его можно, только пока порт
   * свободен.
   */
  async listenPortsOn(
    relayNodeId: string,
  ): Promise<
    Array<{ id: string; protocol: EWgForwardProtocol; port: number }>
  > {
    const rows = await this.find({
      where: { relayNodeId, enabled: true },
      select: { id: true, protocol: true, listenPort: true },
    });

    return rows.map(row => ({
      id: row.id,
      protocol: row.protocol,
      port: row.listenPort,
    }));
  }

  private _withRelations() {
    const qb = this.createQueryBuilder("forward")
      .leftJoinAndSelect("forward.relayNode", "relayNode")
      .leftJoinAndSelect("forward.targetNode", "targetNode");

    joinUserName(qb, "forward.owner", "owner");
    joinUserName(qb, "forward.createdBy", "createdBy");

    return qb;
  }
}
