import { inject, multiInject, optional } from "inversify";

import { Injectable, logger } from "../../core";
import { WgEndpointService } from "../wg-endpoint";
import { WgNodeService } from "../wg-node";
import { IWgRelayConsumer, WG_RELAY_CONSUMER } from "./relay-extensions";
import { WgInterfaceRepository } from "./wg-interface.repository";

/**
 * Приводит релей-линки (IPIP /30) в соответствие фактическому использованию:
 * пара (релей, цель) существует, пока хоть один интерфейс цели подключён
 * через relay-точку этого релея. Идемпотентен — можно вызывать после любого
 * изменения интерфейсов или точек подключения.
 */
@Injectable()
export class WgRelaySyncService {
  constructor(
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgEndpointService)
    private readonly _endpoints: WgEndpointService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @multiInject(WG_RELAY_CONSUMER)
    @optional()
    private readonly _consumers: IWgRelayConsumer[] | undefined = [],
  ) {}

  /**
   * Синхронизировать линки релея; поднимает версии затронутых нод. Версия
   * релея поднимается всегда: его пробросы зависят от портов всех
   * обслуживаемых интерфейсов, а не только от набора линков.
   */
  async syncRelay(relayNodeId: string): Promise<void> {
    const used = new Set(
      await this._interfaces.targetNodeIdsForRelay(relayNodeId),
    );

    for (const consumer of this._consumers ?? []) {
      for (const nodeId of await consumer.ipipTargetsOfRelay(relayNodeId)) {
        if (nodeId !== relayNodeId) used.add(nodeId);
      }
    }
    const links = await this._endpoints.linksForRelay(relayNodeId);
    const existing = new Set(links.map(link => link.targetNodeId));

    for (const targetNodeId of used) {
      if (!existing.has(targetNodeId)) {
        await this._endpoints.ensureLink(relayNodeId, targetNodeId);
        await this._nodes.markDirty(targetNodeId);
      }
    }

    for (const link of links) {
      if (!used.has(link.targetNodeId)) {
        await this._endpoints.deleteLink(relayNodeId, link.targetNodeId);
        await this._nodes.markDirty(link.targetNodeId);
      }
    }

    await this._nodes.markDirty(relayNodeId);
  }

  /** Синхронизация без проброса ошибки (реакции на события). */
  async syncRelaySafe(relayNodeId: string | null | undefined): Promise<void> {
    if (!relayNodeId) return;

    try {
      await this.syncRelay(relayNodeId);
    } catch (err) {
      logger.error({ err, relayNodeId }, "[WG] relay link sync failed");
    }
  }
}
