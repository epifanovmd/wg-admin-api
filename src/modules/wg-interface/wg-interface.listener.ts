import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import {
  ISocketEventListener,
  OwnedEntityEmitter,
  SocketEmitterService,
} from "../socket";
import {
  WgEndpointChangedEvent,
  WgEndpointService,
  WgEndpointUpdatedEvent,
} from "../wg-endpoint";
import {
  WgNodeAgentUnboundEvent,
  WgNodeHostChangedEvent,
  WgNodeService,
} from "../wg-node";
import { WgInterfaceDto } from "./dto";
import {
  WgInterfaceCreatedEvent,
  WgInterfaceDeletedEvent,
  WgInterfaceUpdatedEvent,
} from "./events";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { WgInterfaceService } from "./wg-interface.service";
import { wgInterfaceRoom } from "./wg-interface-room.policy";
import { WgRelaySyncService } from "./wg-relay-sync.service";

/** Комната списка интерфейсов: право `wg:interface:view` на все интерфейсы. */
export const WG_INTERFACES_ROOM = "wg-interfaces";

/**
 * Интерфейсы: изменения — в комнату списка, комнату интерфейса и своим
 * (владельцу и создателю с областью «только свои»); прежний владелец, для
 * которого интерфейс больше не свой, получает `wg:interface:deleted`. Смена
 * точки подключения — пересинхронизация релей-линков и поднятие версий
 * затронутых нод (клиентские конфиги при этом менять не нужно — адрес
 * стабилен).
 */
@Injectable()
export class WgInterfaceListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(OwnedEntityEmitter) private readonly _owned: OwnedEntityEmitter,
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
    @inject(WgRelaySyncService)
    private readonly _relaySync: WgRelaySyncService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgEndpointService) private readonly _endpoints: WgEndpointService,
    @inject(WgInterfaceService)
    private readonly _service: WgInterfaceService,
  ) {}

  register(): void {
    this._eventBus.on(WgInterfaceCreatedEvent, async ({ iface }) => {
      void this._publishEndpoints([iface.endpointId]);
      await this._send(iface);
    });
    this._eventBus.on(
      WgInterfaceUpdatedEvent,
      async ({ iface, previousEndpointId, previousOwnerId }) => {
        void this._publishEndpoints([iface.endpointId, previousEndpointId]);
        await this._send(iface);
        if (previousOwnerId && previousOwnerId !== iface.createdById) {
          await this._owned.detach(previousOwnerId, "wg:interface:deleted", {
            id: iface.id,
          });
        }
      },
    );
    this._eventBus.on(
      WgInterfaceDeletedEvent,
      ({ ifaceId, endpointId, ownerId, createdById }) => {
        const payload = { id: ifaceId };

        for (const room of [WG_INTERFACES_ROOM, wgInterfaceRoom(ifaceId)]) {
          this._emitter.toRoom(room, "wg:interface:deleted", payload);
        }
        void this._publishEndpoints([endpointId]);

        return this._owned.toOwners(
          [ownerId, createdById],
          WgInterfacePermissions.INTERFACE_VIEW,
          "wg:interface:deleted",
          payload,
        );
      },
    );
    // Точка изменилась (режим, релей, маршрут, имя) — у её интерфейсов
    // меняется описание точки в DTO.
    this._eventBus.on(WgEndpointChangedEvent, ({ endpoint }) =>
      this._republishInterfaces(endpoint.id),
    );
    this._eventBus.on(WgEndpointUpdatedEvent, event =>
      this._onEndpointChanged(event),
    );
    this._eventBus.on(WgNodeHostChangedEvent, ({ nodeId }) =>
      this._onNodeHostChanged(nodeId),
    );
    this._eventBus.on(WgNodeAgentUnboundEvent, ({ nodeId }) =>
      this._onAgentUnbound(nodeId),
    );
  }

  /** Агент отвязан: статусы интерфейсов ноды (основных и реплик) — «неизвестно». */
  private async _onAgentUnbound(nodeId: string): Promise<void> {
    try {
      await this._service.updateReportedStatuses(nodeId, []);
    } catch (err) {
      logger.error(
        { err, nodeId },
        "[WG] interface statuses not reset after agent unbind",
      );
    }
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

  /** «Куда ведёт» точек — в комнату списка точек. */
  private async _publishEndpoints(
    endpointIds: Array<string | null>,
  ): Promise<void> {
    try {
      await this._endpoints.publishInterfacesChanged(endpointIds);
    } catch (err) {
      logger.error({ err, endpointIds }, "[WG] endpoint targets not published");
    }
  }

  /** DTO интерфейсов точки заново — в их комнаты. */
  private async _republishInterfaces(endpointId: string): Promise<void> {
    try {
      for (const iface of await this._interfaces.findByEndpoint(endpointId)) {
        await this._send(
          WgInterfaceDto.fromEntity(
            (await this._interfaces.findWithRelations(iface.id)) ?? iface,
          ),
        );
      }
    } catch (err) {
      logger.error(
        { err, endpointId },
        "[WG] interfaces not republished after endpoint change",
      );
    }
  }

  private _send(iface: WgInterfaceDto): Promise<void> {
    this._emitter.toRoom(WG_INTERFACES_ROOM, "wg:interface:updated", iface);
    this._emitter.toRoom(
      wgInterfaceRoom(iface.id),
      "wg:interface:updated",
      iface,
    );

    return this._owned.toOwners(
      [iface.ownerId, iface.createdById],
      WgInterfacePermissions.INTERFACE_VIEW,
      "wg:interface:updated",
      iface,
    );
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
