import { BaseRepository, InjectableRepository } from "../../core";
import { WgInterfaceReplica } from "./wg-interface-replica.entity";

@InjectableRepository(WgInterfaceReplica)
export class WgInterfaceReplicaRepository extends BaseRepository<WgInterfaceReplica> {
  findByInterface(interfaceId: string): Promise<WgInterfaceReplica[]> {
    return this.find({
      where: { interfaceId },
      relations: { node: true },
      order: { priority: "ASC" },
    });
  }
}
