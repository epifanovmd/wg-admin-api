import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { RolePermissionsChangedEvent } from "../role";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import {
  EmailChangedEvent,
  EmailVerifiedEvent,
  PasswordChangedEvent,
  UserDeletedEvent,
  UsernameChangedEvent,
  UserPrivilegesChangedEvent,
} from "./events";
import { UserService } from "./user.service";

@Injectable()
export class UserListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(UserService) private readonly _userService: UserService,
  ) {}

  register(): void {
    this._eventBus.on(EmailVerifiedEvent, (event: EmailVerifiedEvent) => {
      this._emitter.toUser(event.userId, "user:email-verified", {
        verified: true,
      });
    });

    this._eventBus.on(EmailChangedEvent, (event: EmailChangedEvent) => {
      this._emitter.toUser(event.userId, "user:email-changed", {
        email: event.newEmail,
      });
    });

    this._eventBus.on(UserDeletedEvent, (event: UserDeletedEvent) => {
      this._emitter.toUser(event.userId, "session:terminated", {
        sessionId: "all",
      });
      this._emitter.disconnectUser(event.userId);
    });

    // Завершение сессий — в модуле session (по этому же событию, кроме текущей).
    this._eventBus.on(PasswordChangedEvent, (event: PasswordChangedEvent) => {
      this._emitter.toUser(event.userId, "user:password-changed", {
        userId: event.userId,
        method: event.method,
      });
    });

    this._eventBus.on(
      UserPrivilegesChangedEvent,
      (event: UserPrivilegesChangedEvent) => {
        this._emitter.toUser(event.userId, "user:privileges-changed", {
          roles: event.roles,
          permissions: event.permissions,
        });
      },
    );

    this._eventBus.on(
      RolePermissionsChangedEvent,
      async (event: RolePermissionsChangedEvent) => {
        try {
          await this._userService.notifyRoleMembersPrivilegesChanged(
            event.roleId,
          );
        } catch (err) {
          logger.error(
            { err, roleId: event.roleId },
            "Не удалось оповестить пользователей роли об изменении прав",
          );
        }
      },
    );

    this._eventBus.on(UsernameChangedEvent, (event: UsernameChangedEvent) => {
      this._emitter.toUser(event.userId, "user:username-changed", {
        userId: event.userId,
        username: event.username,
      });
    });
  }
}
