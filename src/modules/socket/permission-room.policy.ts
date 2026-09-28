import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import type { ISocketRoomPolicy } from "./socket-rooms";

/**
 * Политика комнаты списка: одна комната на тип (`id` игнорируется), вход — по
 * праву просмотра. Регистрация:
 * `asSocketRoomPolicy(permissionRoomPolicy("users", UserPermissions.VIEW))`.
 */
export const permissionRoomPolicy = (type: string, permission: string) => {
  @Injectable()
  class PermissionRoomPolicy implements ISocketRoomPolicy {
    readonly type = type;

    constructor(
      @inject(AccessService) private readonly _access: AccessService,
    ) {}

    room(): string {
      return type;
    }

    canJoin(userId: string): Promise<boolean> {
      return this._access.can(userId, permission);
    }
  }

  return PermissionRoomPolicy;
};
