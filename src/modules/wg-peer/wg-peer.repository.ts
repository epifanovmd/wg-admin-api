import { In, LessThan } from "typeorm";

import type { Pagination } from "../../core";
import { BaseRepository, InjectableRepository } from "../../core";
import { WgPeerAccess } from "./wg-peer.access";
import { WgPeer } from "./wg-peer.entity";
import { WG_PEER_ONLINE_WINDOW_SEC } from "./wg-peer.types";

export interface IWgPeerFilters {
  interfaceId?: string;
  nodeId?: string;
  userId?: string;
  /** Только свои пиры пользователя: держатель или создатель. */
  ownedBy?: string;
  enabled?: boolean;
  online?: boolean;
  query?: string;
}

@InjectableRepository(WgPeer)
export class WgPeerRepository extends BaseRepository<WgPeer> {
  /**
   * Статистика пачки пиров одним запросом: handshake, адрес клиента и
   * накопленный трафик.
   */
  async updateStatsMany(
    updates: ReadonlyArray<{
      peerId: string;
      lastHandshakeAt: Date | null;
      lastEndpoint: string | null;
      rxBytesTotal: number;
      txBytesTotal: number;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;

    const params: unknown[] = [];
    const rows = updates.map(update => {
      const base = params.length;

      params.push(
        update.peerId,
        update.lastHandshakeAt,
        update.lastEndpoint,
        update.rxBytesTotal,
        update.txBytesTotal,
      );

      return `($${base + 1}::uuid, $${base + 2}::timestamptz, $${base + 3}::varchar, $${base + 4}::bigint, $${base + 5}::bigint)`;
    });

    await this.query(
      `UPDATE wg_peers AS p
       SET last_handshake_at = v.handshake, last_endpoint = v.endpoint,
           rx_bytes_total = v.rx, tx_bytes_total = v.tx
       FROM (VALUES ${rows.join(", ")}) AS v(id, handshake, endpoint, rx, tx)
       WHERE p.id = v.id`,
      params,
    );
  }

  findPage(
    filters: IWgPeerFilters,
    { offset, limit }: Pagination,
  ): Promise<[WgPeer[], number]> {
    const qb = this.createQueryBuilder("peer")
      .leftJoinAndSelect("peer.iface", "iface")
      .leftJoinAndSelect("iface.node", "node")
      .leftJoinAndSelect("iface.endpoint", "endpoint")
      .orderBy("peer.createdAt", "DESC")
      .addOrderBy("peer.id", "DESC")
      .skip(offset)
      .take(limit);

    const { interfaceId, nodeId, userId, ownedBy, enabled, online, query } =
      filters;

    if (interfaceId)
      qb.andWhere("peer.interfaceId = :interfaceId", { interfaceId });
    if (nodeId) qb.andWhere("iface.nodeId = :nodeId", { nodeId });
    if (userId) qb.andWhere("peer.userId = :userId", { userId });
    if (ownedBy) {
      qb.andWhere(WgPeerAccess.ownedCondition("peer"), { ownedBy });
    }
    if (enabled !== undefined)
      qb.andWhere("peer.enabled = :enabled", { enabled });
    if (online !== undefined) {
      const condition = `peer.last_handshake_at > now() - interval '${WG_PEER_ONLINE_WINDOW_SEC} seconds'`;

      qb.andWhere(online ? condition : `NOT (${condition})`);
    }
    if (query) qb.andWhere("peer.name ILIKE :query", { query: `%${query}%` });

    return qb.getManyAndCount();
  }

  findWithRelations(id: string): Promise<WgPeer | null> {
    return this.findOne({
      where: { id },
      relations: { iface: { node: true, endpoint: true } },
    });
  }

  /** Занятые IPv4-адреса интерфейса. */
  async usedAddresses(interfaceId: string): Promise<string[]> {
    const peers = await this.find({
      where: { interfaceId },
      select: { addressV4: true },
    });

    return peers.map(peer => peer.addressV4);
  }

  /** Включённые пиры интерфейсов — для desired state агента. */
  findEnabledByInterfaces(interfaceIds: string[]): Promise<WgPeer[]> {
    if (interfaceIds.length === 0) return Promise.resolve([]);

    return this.find({
      where: { interfaceId: In(interfaceIds), enabled: true },
      order: { createdAt: "ASC" },
    });
  }

  /** Просроченные включённые пиры (для cron-отключения). */
  findExpired(now: Date): Promise<WgPeer[]> {
    return this.find({
      where: { enabled: true, expiresAt: LessThan(now) },
      relations: { iface: true },
    });
  }

  findByPublicKeys(
    interfaceId: string,
    publicKeys: string[],
  ): Promise<WgPeer[]> {
    if (publicKeys.length === 0) return Promise.resolve([]);

    return this.find({
      where: { interfaceId, publicKey: In(publicKeys) },
    });
  }
}
