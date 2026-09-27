import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { WgEndpointService, WgEndpointUpdatedEvent } from "../wg-endpoint";
import {
  WG_OVERVIEW_ROOM,
  WgNodeHostChangedEvent,
  wgNodeRoom,
  WgNodeService,
} from "../wg-node";
import {
  WgInterfaceCreatedEvent,
  WgInterfaceDeletedEvent,
  WgInterfaceUpdatedEvent,
} from "./events";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { wgInterfaceRoom } from "./wg-interface-room.policy";
import { WgRelaySyncService } from "./wg-relay-sync.service";

/**
 * Интерфейсы: изменения — подписчикам комнат; смена точки подключения —
 * пересинхронизация релей-линков и поднятие версий затронутых нод
 * (клиентские конфиги при этом менять не нужно — адрес стабилен).
 */
@Injectable()
export class WgInterfaceListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgRelaySyncService)
    private readonly _relaySync: WgRelaySyncService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgEndpointService) private readonly _endpoints: WgEndpointService,
  ) {}

  register(): void {
    this._eventBus.on(WgInterfaceCreatedEvent, ({ iface }) =>
      this._send(iface),
    );
    this._eventBus.on(WgInterfaceUpdatedEvent, ({ iface }) =>
      this._send(iface),
    );
    this._eventBus.on(WgInterfaceDeletedEvent, ({ ifaceId, nodeIds }) => {
      const rooms = [
        WG_OVERVIEW_ROOM,
        wgInterfaceRoom(ifaceId),
        ...new Set(nodeIds.map(wgNodeRoom)),
      ];

      for (const room of rooms) {
        this._emitter.toRoom(room, "wg:interface:deleted", { id: ifaceId });
      }
    });
    this._eventBus.on(WgEndpointUpdatedEvent, event =>
      this._onEndpointChanged(event),
    );
    this._eventBus.on(WgNodeHostChangedEvent, ({ nodeId }) =>
      this._onNodeHostChanged(nodeId),
    );
  }

  /** Новый publicHost ноды — пересобрать конфигурации связанных релеев и целей. */
  private async _onNodeHostChanged(nodeId: string): Promise<void> {
    try {
      const links = await this._endpoints.linksForNode(nodeId);
      const counterparts = links.map(link =>
        link.relayNodeId === nodeId ? link.targetNodeId : link.relayNodeId,
      );

      if (counterparts.length > 0) {
        await this._nodes.markDirtyMany(counterparts);
      }
    } catch (err) {
      logger.error(
        { err, nodeId },
        "[WG] relay configs not rebuilt after host change",
      );
    }
  }

  private _send(iface: WgInterfaceUpdatedEvent["iface"]): void {
    this._emitter.toRoom(
      wgInterfaceRoom(iface.id),
      "wg:interface:updated",
      iface,
    );
    this._emitter.toRoom(WG_OVERVIEW_ROOM, "wg:interface:updated", iface);
    // Страницы нод основной копии и реплик.
    const nodeIds = new Set([
      iface.nodeId,
      ...iface.replicas.map(replica => replica.nodeId),
    ]);

    for (const nodeId of nodeIds) {
      this._emitter.toRoom(wgNodeRoom(nodeId), "wg:interface:updated", iface);
    }
  }

  /** Точка подключения изменилась: линки и версии конфигурации нод. */
  private async _onEndpointChanged(
    event: WgEndpointUpdatedEvent,
  ): Promise<void> {
    try {
      const affected = await this._interfaces.findByEndpoint(event.endpoint.id);

      await this._nodes.markDirtyMany(
        affected.flatMap(iface => [
          iface.nodeId,
          ...(iface.replicas ?? []).map(replica => replica.nodeId),
        ]),
      );
      await this._relaySync.syncRelaySafe(event.previous.relayNodeId);
      await this._relaySync.syncRelaySafe(event.endpoint.relayNodeId);
    } catch (err) {
      logger.error(
        { err, endpointId: event.endpoint.id },
        "[WG] endpoint change propagation failed",
      );
    }
  }
}
