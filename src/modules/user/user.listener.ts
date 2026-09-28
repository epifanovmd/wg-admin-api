import { inject } from "inversify";

import { AccessService, EventBus, Injectable, logger } from "../../core";
import { ProfileUpdatedEvent } from "../profile/events";
import { RoleDeletedEvent, RolePermissionsChangedEvent } from "../role";
import {
  ISocketEventListener,
  SocketEmitterService,
  SocketRoomService,
} from "../socket";
import {
  EmailChangedEvent,
  EmailVerifiedEvent,
  PasswordChangedEvent,
  UserChangedEvent,
  UserDeletedEvent,
  UsernameChangedEvent,
  UserPrivilegesChangedEvent,
} from "./events";
import { UserService } from "./user.service";

/** Комната списка пользователей: право `user:view`. */
export const USERS_ROOM = "users";

/**
 * События пользователя: самому пользователю — адресно; списку
 * пользователей (комната `users`) — актуальный `UserDto` при любом изменении.
 */
@Injectable()
export class UserListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(UserService) private readonly _userService: UserService,
    @inject(AccessService) private readonly _access: AccessService,
    @inject(SocketRoomService) private readonly _rooms: SocketRoomService,
  ) {}

  register(): void {
    const changedBy = [
      UserChangedEvent,
      UserPrivilegesChangedEvent,
      EmailChangedEvent,
      EmailVerifiedEvent,
      UsernameChangedEvent,
    ];

    for (const EventClass of changedBy) {
      this._eventBus.on(EventClass, (event: { userId: string }) =>
        this._sendUser(event.userId),
      );
    }
    this._eventBus.on(ProfileUpdatedEvent, ({ profile }) =>
      this._sendUser(profile.userId),
    );

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
      this._emitter.toRoom(USERS_ROOM, "user:deleted", { id: event.userId });
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

    // Клиенту — эффективные права (роли ∪ прямые); из комнат, на которые
    // права больше нет, сокеты выводятся.
    this._eventBus.on(
      UserPrivilegesChangedEvent,
      async (event: UserPrivilegesChangedEvent) => {
        try {
          const grant = await this._access.grantOf(event.userId);

          this._emitter.toUser(event.userId, "user:privileges-changed", grant);
          await this._rooms.revalidateUser(event.userId);
        } catch (err) {
          logger.error(
            { err, userId: event.userId },
            "Не удалось применить смену прав к соединениям пользователя",
          );
        }
      },
    );

    this._eventBus.on(RoleDeletedEvent, async (event: RoleDeletedEvent) => {
      try {
        await this._userService.notifyUsersPrivilegesChanged(event.memberIds);
      } catch (err) {
        logger.error(
          { err, roleId: event.roleId },
          "Не удалось пересчитать права пользователей удалённой роли",
        );
      }
    });

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

  /** Актуальный пользователь — в комнату списка пользователей. */
  private async _sendUser(userId: string): Promise<void> {
    try {
      const user = await this._userService.getUser(userId);

      this._emitter.toRoom(
        USERS_ROOM,
        "user:updated",
        await this._userService.toUserDto(user),
      );
    } catch (err) {
      logger.warn({ err, userId }, "[User] user:updated not sent");
    }
  }
}
