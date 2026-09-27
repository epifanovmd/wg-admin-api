import { inject } from "inversify";

import { EventBus, Injectable, logger, TokenService } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import {
  PasswordChangedEvent,
  UserDeletedEvent,
  UserPrivilegesChangedEvent,
} from "../user/events";
import { SessionTerminatedEvent } from "./events";
import { SessionService } from "./session.service";

/**
 * Жизненный цикл сессий по доменным событиям. Завершение сессии рвёт её
 * сокеты (access-токен отзывает сам `SessionService`); смена пароля и прав
 * завершает сессии; удаление пользователя отзывает все его access-токены и
 * рвёт сокеты.
 */
@Injectable()
export class SessionListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(SessionService)
    private readonly _sessionService: SessionService,
    @inject(TokenService) private readonly _tokenService: TokenService,
  ) {}

  register(): void {
    this._eventBus.on(SessionTerminatedEvent, event =>
      this._safely("session-terminated", async () => {
        this._emitter.toUser(event.userId, "session:terminated", {
          sessionId: event.sessionId,
        });
        await this._emitter.disconnectSession(event.userId, event.sessionId);
      }),
    );

    this._eventBus.on(PasswordChangedEvent, event =>
      this._safely("password-changed", () =>
        event.currentSessionId
          ? this._sessionService.terminateAllOther(
              event.userId,
              event.currentSessionId,
              "password-changed",
            )
          : this._sessionService.terminateAllByUser(
              event.userId,
              undefined,
              "password-changed",
            ),
      ),
    );

    this._eventBus.on(UserPrivilegesChangedEvent, event =>
      this._safely("privileges-changed", () =>
        this._sessionService.terminateAllByUser(
          event.userId,
          undefined,
          "privileges-changed",
        ),
      ),
    );

    this._eventBus.on(UserDeletedEvent, event =>
      this._safely("user-deleted", async () => {
        // Сессии удалены каскадом без событий — отзываем все токены пользователя.
        await this._tokenService.revokeUser(event.userId);
        this._emitter.disconnectUser(event.userId);
      }),
    );
  }

  private async _safely(name: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (err) {
      logger.error({ err, event: name }, "[Session] Listener failed");
    }
  }
}
