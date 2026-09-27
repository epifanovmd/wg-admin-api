import { BaseRepository, InjectableRepository } from "../../core";
import { WgRelayLink } from "./wg-relay-link.entity";

@InjectableRepository(WgRelayLink)
export class WgRelayLinkRepository extends BaseRepository<WgRelayLink> {
  findPair(
    relayNodeId: string,
    targetNodeId: string,
  ): Promise<WgRelayLink | null> {
    return this.findOne({ where: { relayNodeId, targetNodeId } });
  }

  findByRelay(relayNodeId: string): Promise<WgRelayLink[]> {
    return this.find({ where: { relayNodeId } });
  }

  findByTarget(targetNodeId: string): Promise<WgRelayLink[]> {
    return this.find({ where: { targetNodeId } });
  }

  /** Наименьший свободный индекс /30-блока. */
  async nextTunnelIndex(): Promise<number> {
    const used = await this.find({
      select: { tunnelIndex: true },
      order: { tunnelIndex: "ASC" },
    });
    let index = 0;

    for (const link of used) {
      if (link.tunnelIndex !== index) break;
      index += 1;
    }

    return index;
  }
}
