import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import {
  RoleCreatedEvent,
  RoleDeletedEvent,
  RolePermissionsChangedEvent,
} from "./events";
import { RoleService } from "./role.service";

/** Комната списка ролей: право `role:view`. */
export const ROLES_ROOM = "roles";

/** Изменения ролей — в комнату списка ролей. */
@Injectable()
export class RoleListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(RoleService) private readonly _roles: RoleService,
  ) {}

  register(): void {
    this._eventBus.on(RoleCreatedEvent, ({ roleId }) => this._send(roleId));
    this._eventBus.on(RolePermissionsChangedEvent, ({ roleId }) =>
      this._send(roleId),
    );
    this._eventBus.on(RoleDeletedEvent, ({ roleId }) =>
      this._emitter.toRoom(ROLES_ROOM, "role:deleted", { id: roleId }),
    );
  }

  private async _send(roleId: string): Promise<void> {
    try {
      const role = await this._roles.getRole(roleId);

      this._emitter.toRoom(ROLES_ROOM, "role:updated", role.toDTO());
    } catch (err) {
      logger.warn({ err, roleId }, "[Role] role:updated not sent");
    }
  }
}
