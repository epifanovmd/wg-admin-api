import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgPeerAccess } from "./wg-peer.access";
import { WgPeerPermissions } from "./wg-peer.permissions";
import { WgPeerRepository } from "./wg-peer.repository";

export const wgPeerRoom = (id: string): string => `wg-peer_${id}`;

/**
 * Комната пира: live-статистика и статус — право на все пиры либо свой пир
 * (держатель или создатель) с правом `wg:peer:view:own`.
 */
@Injectable()
export class WgPeerRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-peer";

  constructor(
    @inject(AccessService) private readonly _access: AccessService,
    @inject(WgPeerRepository) private readonly _peers: WgPeerRepository,
  ) {}

  room(id: string): string {
    return wgPeerRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    const scope = await this._access.scope(userId, WgPeerPermissions.PEER_VIEW);

    if (scope === "all") return true;
    if (scope !== "own") return false;

    const peer = await this._peers.findOne({ where: { id } });

    return peer !== null && WgPeerAccess.isOwn(userId, peer);
  }
}

export const wgOwnPeersRoom = (userId: string): string =>
  `wg-peers-own_${userId}`;

/**
 * Комната «мои пиры»: live-статистика своих пиров (держатель или создатель).
 * Только своя (`id` — свой `userId`) и с правом просмотра пиров.
 */
@Injectable()
export class WgOwnPeersRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-peers-own";

  constructor(@inject(AccessService) private readonly _access: AccessService) {}

  room(id: string): string {
    return wgOwnPeersRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    if (id !== userId) return false;

    return (
      (await this._access.scope(userId, WgPeerPermissions.PEER_VIEW)) !== null
    );
  }
}
