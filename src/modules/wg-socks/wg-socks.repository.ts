import { BaseRepository, InjectableRepository } from "../../core";
import { WgSocksClient, WgSocksService, WgSocksUser } from "./wg-socks.entity";

@InjectableRepository(WgSocksService)
export class WgSocksServiceRepository extends BaseRepository<WgSocksService> {
  findWithRelations(id: string): Promise<WgSocksService | null> {
    return this.findOne({
      where: { id },
      relations: { node: true, users: true, clients: true },
    });
  }

  findAllWithRelations(): Promise<WgSocksService[]> {
    return this.find({
      relations: { node: true, users: true, clients: true },
      order: { createdAt: "DESC" },
    });
  }

  /** Включённые сервисы ноды с пользователями и клиентами — desired state. */
  findActiveByNode(nodeId: string): Promise<WgSocksService[]> {
    return this.find({
      where: { nodeId, enabled: true },
      relations: { users: true, clients: true },
    });
  }
}

@InjectableRepository(WgSocksUser)
export class WgSocksUserRepository extends BaseRepository<WgSocksUser> {}

@InjectableRepository(WgSocksClient)
export class WgSocksClientRepository extends BaseRepository<WgSocksClient> {}
