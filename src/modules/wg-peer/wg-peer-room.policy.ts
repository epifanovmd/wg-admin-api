import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgPeerPermissions } from "./wg-peer.permissions";
import { WgPeerRepository } from "./wg-peer.repository";

export const wgPeerRoom = (id: string): string => `wg-peer_${id}`;

/**
 * Комната пира: live-статистика и статус — право `wg:peer:view` либо
 * держатель пира с правом `wg:peer:own`.
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
    if (await this._access.can(userId, WgPeerPermissions.PEER_VIEW)) {
      return true;
    }
    if (!(await this._access.can(userId, WgPeerPermissions.PEER_OWN))) {
      return false;
    }

    const peer = await this._peers.findOne({ where: { id } });

    return peer?.userId === userId;
  }
}

export const wgOwnPeersRoom = (userId: string): string =>
  `wg-peers-own_${userId}`;

/**
 * Комната «мои пиры» держателя: live-статистика его пиров для списка своих
 * подключений. Только своя (`id` — свой `userId`) и с правом `wg:peer:own`.
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

    return this._access.can(userId, WgPeerPermissions.PEER_OWN);
  }
}
