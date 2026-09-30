import { BaseRepository, InjectableRepository } from "../../core";
import { joinUserName } from "../user/user-name";
import { WgSocksAccess } from "./wg-socks.access";
import { WgSocksClient, WgSocksService, WgSocksUser } from "./wg-socks.entity";

@InjectableRepository(WgSocksService)
export class WgSocksServiceRepository extends BaseRepository<WgSocksService> {
  /** Прокси с нодой, пользователями, клиентами и именами владельца и создателя. */
  findWithRelations(id: string): Promise<WgSocksService | null> {
    return this._withRelations().where("socks.id = :id", { id }).getOne();
  }

  /** Все прокси; `ownedBy` — только свои (владелец или создатель). */
  findAllWithRelations(ownedBy?: string): Promise<WgSocksService[]> {
    const qb = this._withRelations().orderBy("socks.createdAt", "DESC");

    if (ownedBy) {
      qb.andWhere(WgSocksAccess.ownedCondition("socks"), { ownedBy });
    }

    return qb.getMany();
  }

  /** Включённые сервисы ноды с пользователями и клиентами — desired state. */
  findActiveByNode(nodeId: string): Promise<WgSocksService[]> {
    return this.find({
      where: { nodeId, enabled: true },
      relations: { users: true, clients: true },
    });
  }

  private _withRelations() {
    const qb = this.createQueryBuilder("socks")
      .leftJoinAndSelect("socks.node", "node")
      .leftJoinAndSelect("socks.users", "socksUser")
      .leftJoinAndSelect("socks.clients", "socksClient");

    joinUserName(qb, "socks.owner", "owner");
    joinUserName(qb, "socks.createdBy", "createdBy");

    return qb;
  }
}

@InjectableRepository(WgSocksUser)
export class WgSocksUserRepository extends BaseRepository<WgSocksUser> {}

@InjectableRepository(WgSocksClient)
export class WgSocksClientRepository extends BaseRepository<WgSocksClient> {}
