import { inject } from "inversify";

import { AccessService, Injectable, logger } from "../../core";
import { ISocketEmitEvents } from "./socket.types";
import { SocketEmitterService } from "./socket-emitter.service";
import { SocketRoomService } from "./socket-room.service";

/**
 * Рассылка изменений сущностей с владельцем. Держатели права на все
 * получают их в комнате списка; пользователи с областью «только свои» —
 * в личную комнату, если они владелец или создатель сущности.
 */
@Injectable()
export class OwnedEntityEmitter {
  constructor(
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
    @inject(SocketRoomService) private readonly _rooms: SocketRoomService,
    @inject(AccessService) private readonly _access: AccessService,
  ) {}

  /** Событие своим: владельцу и создателю с областью `own` права просмотра. */
  async toOwners<K extends keyof ISocketEmitEvents>(
    userIds: ReadonlyArray<string | null>,
    viewPermission: string,
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): Promise<void> {
    const unique = [...new Set(userIds)].filter(
      (id): id is string => id !== null,
    );

    await Promise.all(
      unique.map(async userId => {
        try {
          if ((await this._access.scope(userId, viewPermission)) === "own") {
            this._emitter.toUser(userId, event, ...args);
          }
        } catch (err) {
          logger.error({ err, userId, event }, "[Socket] owner not notified");
        }
      }),
    );
  }

  /**
   * Сущность перестала быть своей для пользователя (сменился владелец):
   * убрать её из его списков и закрыть комнаты, куда он больше не вправе.
   */
  async detach<K extends keyof ISocketEmitEvents>(
    userId: string,
    event: K,
    ...args: Parameters<ISocketEmitEvents[K]>
  ): Promise<void> {
    this._emitter.toUser(userId, event, ...args);

    try {
      await this._rooms.revalidateUser(userId);
    } catch (err) {
      logger.error(
        { err, userId },
        "[Socket] rooms of former owner not revalidated",
      );
    }
  }
}
