import { In } from "typeorm";

import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { EWgEndpointMode, WgEndpoint } from "../wg-endpoint";
import { WgInterface } from "./wg-interface.entity";
import { WgInterfaceReplica } from "./wg-interface-replica.entity";

export interface IWgInterfaceFilters {
  /** Основная нода интерфейса. */
  nodeId?: string;
  /** Нода, где интерфейс работает: основная или копия. */
  hostNodeId?: string;
  endpointId?: string;
  /** Только интерфейсы за точками через релей. */
  viaRelay?: boolean;
  enabled?: boolean;
  query?: string;
}

@InjectableRepository(WgInterface)
export class WgInterfaceRepository extends BaseRepository<WgInterface> {
  findPage(
    {
      nodeId,
      hostNodeId,
      endpointId,
      viaRelay,
      enabled,
      query,
    }: IWgInterfaceFilters,
    { offset, limit }: Pagination,
  ): Promise<[WgInterface[], number]> {
    const qb = this.createQueryBuilder("iface")
      .leftJoinAndSelect("iface.node", "node")
      .leftJoinAndSelect("iface.endpoint", "endpoint")
      .leftJoinAndSelect("endpoint.relayNode", "relayNode")
      .leftJoinAndSelect("iface.replicas", "replica")
      .leftJoinAndSelect("replica.node", "replicaNode")
      .orderBy("iface.createdAt", "DESC")
      .addOrderBy("iface.id", "DESC")
      .skip(offset)
      .take(limit);

    if (nodeId) qb.andWhere("iface.nodeId = :nodeId", { nodeId });
    if (hostNodeId) {
      qb.andWhere(
        `(iface.nodeId = :hostNodeId OR EXISTS (
          SELECT 1 FROM wg_interface_replicas hr
          WHERE hr.interface_id = iface.id AND hr.node_id = :hostNodeId
        ))`,
        { hostNodeId },
      );
    }
    if (endpointId)
      qb.andWhere("iface.endpointId = :endpointId", { endpointId });
    if (viaRelay)
      qb.andWhere("endpoint.mode = :relayMode", {
        relayMode: EWgEndpointMode.Relay,
      });
    if (enabled !== undefined)
      qb.andWhere("iface.enabled = :enabled", { enabled });
    if (query) qb.andWhere("iface.name ILIKE :query", { query: `%${query}%` });

    return qb.getManyAndCount();
  }

  findWithRelations(id: string): Promise<WgInterface | null> {
    return this.findOne({
      where: { id },
      relations: {
        node: true,
        endpoint: { relayNode: true },
        replicas: { node: true },
      },
      order: { replicas: { priority: "ASC" } },
    });
  }

  findByNode(nodeId: string): Promise<WgInterface[]> {
    return this.find({
      where: { nodeId },
      relations: { endpoint: true },
      order: { name: "ASC" },
    });
  }

  findByEndpoint(endpointId: string): Promise<WgInterface[]> {
    return this.find({
      where: { endpointId },
      relations: { node: true, replicas: true },
    });
  }

  /** Интерфейсы точек (с нодами и копиями) — одним запросом на список точек. */
  findByEndpoints(endpointIds: string[]): Promise<WgInterface[]> {
    return endpointIds.length
      ? this.find({
          where: { endpointId: In(endpointIds) },
          relations: { node: true, replicas: true },
          order: { name: "ASC", replicas: { priority: "ASC" } },
        })
      : Promise.resolve([]);
  }

  /** id целевых нод, чьи интерфейсы подключены через relay-точки этой ноды (кроме неё самой). */
  async targetNodeIdsForRelay(relayNodeId: string): Promise<string[]> {
    const rows: Array<{ nodeId: string }> = await this.createQueryBuilder(
      "iface",
    )
      .innerJoin(WgEndpoint, "endpoint", "endpoint.id = iface.endpoint_id")
      .where("endpoint.relay_node_id = :relayNodeId", { relayNodeId })
      .andWhere("iface.node_id <> :relayNodeId")
      .select("DISTINCT iface.node_id", "nodeId")
      .getRawMany();
    // Реплики интерфейсов за точками релея — тоже цели его туннелей.
    const replicaRows: Array<{ nodeId: string }> =
      await this.createQueryBuilder("iface")
        .innerJoin(WgEndpoint, "endpoint", "endpoint.id = iface.endpoint_id")
        .innerJoin(WgInterfaceReplica, "r", "r.interface_id = iface.id")
        .where("endpoint.relay_node_id = :relayNodeId", { relayNodeId })
        .andWhere("r.node_id <> :relayNodeId")
        .select("DISTINCT r.node_id", "nodeId")
        .getRawMany();

    return [...new Set([...rows, ...replicaRows].map(row => row.nodeId))];
  }

  /** Интерфейсы, обслуживаемые релей-точками ноды (для desired state релея). */
  findServedByRelay(relayNodeId: string): Promise<WgInterface[]> {
    return this.createQueryBuilder("iface")
      .innerJoinAndSelect("iface.endpoint", "endpoint")
      .innerJoinAndSelect("iface.node", "node")
      .leftJoinAndSelect("iface.replicas", "replica")
      .leftJoinAndSelect("replica.node", "replicaNode")
      .where("endpoint.relay_node_id = :relayNodeId", { relayNodeId })
      .andWhere("iface.node_id <> :relayNodeId")
      .getMany();
  }

  /** Конфликт эффективного порта на точке подключения. */
  async endpointPortInUse(
    endpointId: string,
    effectivePort: number,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.createQueryBuilder("iface")
      .where("iface.endpoint_id = :endpointId", { endpointId })
      .andWhere("COALESCE(iface.endpoint_port, iface.listen_port) = :port", {
        port: effectivePort,
      });

    if (excludeId) qb.andWhere("iface.id != :excludeId", { excludeId });

    return (await qb.getCount()) > 0;
  }

  /**
   * Порт `port` уже пробрасывается релей-нодой (через любую её relay-точку).
   * `exclude` — не учитывать интерфейс или интерфейсы точки.
   */
  async relayForwardPortInUse(
    relayNodeId: string,
    port: number,
    exclude: { interfaceId?: string; endpointId?: string } = {},
  ): Promise<boolean> {
    const qb = this.createQueryBuilder("iface")
      .innerJoin(WgEndpoint, "endpoint", "endpoint.id = iface.endpoint_id")
      .where("endpoint.mode = :mode", { mode: EWgEndpointMode.Relay })
      .andWhere("endpoint.relay_node_id = :relayNodeId", { relayNodeId })
      .andWhere("COALESCE(iface.endpoint_port, iface.listen_port) = :port", {
        port,
      });

    if (exclude.interfaceId) {
      qb.andWhere("iface.id != :interfaceId", {
        interfaceId: exclude.interfaceId,
      });
    }
    if (exclude.endpointId) {
      qb.andWhere("iface.endpoint_id != :endpointId", {
        endpointId: exclude.endpointId,
      });
    }

    return (await qb.getCount()) > 0;
  }

  /**
   * Порт слушает интерфейс ноды — свой или реплика чужого (`exclude` — не
   * учитывать этот интерфейс).
   */
  async nodeListenPortInUse(
    nodeId: string,
    port: number,
    excludeInterfaceId?: string,
  ): Promise<boolean> {
    return this._onNodeWhere(nodeId, excludeInterfaceId)
      .andWhere("iface.listen_port = :port", { port })
      .getExists();
  }

  /** Имя интерфейса занято на ноде (своим или репликой). */
  nodeNameInUse(
    nodeId: string,
    name: string,
    excludeInterfaceId?: string,
  ): Promise<boolean> {
    return this._onNodeWhere(nodeId, excludeInterfaceId)
      .andWhere("iface.name = :name", { name })
      .getExists();
  }

  /** Интерфейсы, которые поднимает нода: свои и реплики чужих. */
  findForNode(nodeId: string): Promise<WgInterface[]> {
    return this._onNodeWhere(nodeId)
      .leftJoinAndSelect("iface.endpoint", "endpoint")
      .orderBy("iface.name", "ASC")
      .getMany();
  }

  /** Ноды всех копий интерфейса: основная и реплики. */
  async nodeIdsOf(interfaceId: string): Promise<string[]> {
    const iface = await this.findOne({
      where: { id: interfaceId },
      select: { id: true, nodeId: true },
    });
    const replicas = await this.manager
      .getRepository(WgInterfaceReplica)
      .find({ where: { interfaceId }, select: { nodeId: true } });

    return iface ? [iface.nodeId, ...replicas.map(r => r.nodeId)] : [];
  }

  private _onNodeWhere(nodeId: string, excludeInterfaceId?: string) {
    const qb = this.createQueryBuilder("iface").where(
      `(iface.node_id = :nodeId OR EXISTS (SELECT 1 FROM wg_interface_replicas r
        WHERE r.interface_id = iface.id AND r.node_id = :nodeId))`,
      { nodeId },
    );

    if (excludeInterfaceId) {
      qb.andWhere("iface.id != :excludeInterfaceId", { excludeInterfaceId });
    }

    return qb;
  }
}
