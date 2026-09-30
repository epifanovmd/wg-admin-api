import { inject } from "inversify";
import { DataSource, Not } from "typeorm";

import { EventBus, Injectable } from "../../core";
import type { AuthContext } from "../../types/koa";
import { WgNodePermissions, WgNodeService } from "../wg-node";
import { WgInterfaceDto } from "./dto";
import { WgInterfaceError } from "./wg-interface.errors";
import { WgInterfaceGuard } from "./wg-interface.guard";
import { emitInterfaceUpdated, findInterfaceFor } from "./wg-interface.lookup";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import { WgInterfaceRepository } from "./wg-interface.repository";
import { EWgInterfaceStatus } from "./wg-interface.types";
import { WgInterfaceReplicaRepository } from "./wg-interface-replica.repository";
import { WgRelaySyncService } from "./wg-relay-sync.service";

/**
 * Реплики интерфейса: копии на других нодах (тот же ключ, адреса и пиры),
 * их статусы и копия, обслуживающая трафик релея.
 */
@Injectable()
export class WgInterfaceReplicaService {
  constructor(
    @inject(WgInterfaceRepository)
    private readonly _repo: WgInterfaceRepository,
    @inject(WgInterfaceReplicaRepository)
    private readonly _replicas: WgInterfaceReplicaRepository,
    @inject(WgInterfaceGuard) private readonly _guard: WgInterfaceGuard,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgRelaySyncService) private readonly _relaySync: WgRelaySyncService,
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(DataSource) private readonly _dataSource: DataSource,
  ) {}

  /**
   * Скопировать интерфейс на ноду: тот же ключ, адреса и пиры. Релей точки
   * получает туннель до новой реплики и добавляет её в резерв. Нода копии
   * должна быть видна актору.
   */
  async addReplica(
    actor: AuthContext,
    id: string,
    nodeId: string,
  ): Promise<WgInterfaceDto> {
    const iface = await findInterfaceFor(
      this._repo,
      actor,
      id,
      WgInterfacePermissions.INTERFACE_REPLICAS,
    );

    if (nodeId === iface.nodeId) throw WgInterfaceError.REPLICA_IS_PRIMARY();
    if (iface.replicas?.some(replica => replica.nodeId === nodeId)) {
      throw WgInterfaceError.REPLICA_EXISTS();
    }

    await this._nodes.findFor(actor, nodeId, WgNodePermissions.NODE_VIEW);
    await this._guard.assertNodeFree(nodeId, iface);
    if (iface.endpoint) this._guard.assertRelayNotSelf(iface.endpoint, nodeId);
    await this._guard.assertRelayPortsFree({
      id: iface.id,
      nodeId,
      listenPort: iface.listenPort,
      endpointPort: iface.endpointPort,
      endpoint: null,
    });

    const priority =
      Math.max(0, ...(iface.replicas ?? []).map(replica => replica.priority)) +
      1;

    await this._dataSource.transaction(async manager => {
      await this._replicas
        .getRepository(manager)
        .save({ interfaceId: iface.id, nodeId, priority });
      await this._nodes.markDirty(nodeId, manager);
    });
    await this._relaySync.syncRelaySafe(iface.endpoint?.relayNodeId);

    return emitInterfaceUpdated(this._repo, this._eventBus, iface.id);
  }

  /** Убрать реплику: агент ноды снимет интерфейс, релей — её из резерва. */
  async removeReplica(
    actor: AuthContext,
    id: string,
    nodeId: string,
  ): Promise<void> {
    const iface = await findInterfaceFor(
      this._repo,
      actor,
      id,
      WgInterfacePermissions.INTERFACE_REPLICAS,
    );

    if (!iface.replicas?.some(replica => replica.nodeId === nodeId)) {
      throw WgInterfaceError.REPLICA_NOT_FOUND();
    }

    await this._dataSource.transaction(async manager => {
      await this._replicas
        .getRepository(manager)
        .delete({ interfaceId: iface.id, nodeId });
      if (iface.activeReplicaNodeId === nodeId) {
        await this._repo
          .getRepository(manager)
          .update({ id: iface.id }, { activeReplicaNodeId: null });
      }
      await this._nodes.markDirty(nodeId, manager);
    });
    await this._relaySync.syncRelaySafe(iface.endpoint?.relayNodeId);
    await emitInterfaceUpdated(this._repo, this._eventBus, iface.id);
  }

  /**
   * Отчёт релея: какая копия интерфейса обслуживает трафик его точки.
   * Пишется только при смене — UI получает событие переключения.
   */
  async recordServingNodes(
    relayNodeId: string,
    statuses: Array<{ id: string; activeNodeId?: string }>,
  ): Promise<void> {
    for (const status of statuses) {
      if (!status.activeNodeId) continue;

      const result = await this._repo
        .createQueryBuilder()
        .update()
        .set({ servingNodeId: status.activeNodeId })
        .where("id = :id", { id: status.id })
        .andWhere(
          "endpoint_id IN (SELECT id FROM wg_endpoints WHERE relay_node_id = :relayNodeId)",
          { relayNodeId },
        )
        .andWhere("serving_node_id IS DISTINCT FROM :nodeId", {
          nodeId: status.activeNodeId,
        })
        .execute();

      if (result.affected) {
        await emitInterfaceUpdated(this._repo, this._eventBus, status.id);
      }
    }
  }

  /**
   * Статус реплики из отчёта агента её ноды; событие — только при смене.
   * Реплика поднялась или упала — релей точки получает новую версию: в его
   * резерве только поднятые копии.
   */
  async updateStatus(
    interfaceId: string,
    nodeId: string,
    status: EWgInterfaceStatus,
    message: string | null,
  ): Promise<void> {
    const previous = await this._replicas.findOne({
      where: { interfaceId, nodeId },
      relations: { iface: { endpoint: true } },
    });

    if (!previous || previous.status === status) return;

    const relayNodeId = previous.iface?.endpoint?.relayNodeId ?? null;
    const servingChanged =
      (previous.status === EWgInterfaceStatus.Up) !==
      (status === EWgInterfaceStatus.Up);

    await this._dataSource.transaction(async manager => {
      const result = await this._replicas
        .getRepository(manager)
        .update(
          { interfaceId, nodeId, status: Not(status) },
          { status, statusMessage: message },
        );

      if (result.affected && servingChanged && relayNodeId) {
        await this._nodes.markDirty(relayNodeId, manager);
      }
    });
    await emitInterfaceUpdated(this._repo, this._eventBus, interfaceId);
  }
}
