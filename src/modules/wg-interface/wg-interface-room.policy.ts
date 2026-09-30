import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { WgInterfaceAccess } from "./wg-interface.access";
import { WgInterfacePermissions } from "./wg-interface.permissions";
import { WgInterfaceRepository } from "./wg-interface.repository";

export const wgInterfaceRoom = (id: string): string => `wg-interface_${id}`;

/**
 * Комната интерфейса: статус и live-статистика — право на все интерфейсы
 * либо свой интерфейс (владелец или создатель) с `wg:interface:view:own`.
 */
@Injectable()
export class WgInterfaceRoomPolicy implements ISocketRoomPolicy {
  readonly type = "wg-interface";

  constructor(
    @inject(AccessService) private readonly _access: AccessService,
    @inject(WgInterfaceRepository)
    private readonly _interfaces: WgInterfaceRepository,
  ) {}

  room(id: string): string {
    return wgInterfaceRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    const scope = await this._access.scope(
      userId,
      WgInterfacePermissions.INTERFACE_VIEW,
    );

    if (scope === "all") return true;
    if (scope !== "own") return false;

    const iface = await this._interfaces.findOne({ where: { id } });

    return iface !== null && WgInterfaceAccess.isOwn(userId, iface);
  }
}
