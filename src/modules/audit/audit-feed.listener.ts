import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { AuditRecordedEvent } from "./events";

/** Комната общего журнала безопасности: право `audit:view`. */
export const AUDIT_ROOM = "audit";

/** Новая запись журнала — в общий журнал и в «Мою активность» её автора. */
@Injectable()
export class AuditFeedListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(AuditRecordedEvent, ({ event }) => {
      this._emitter.toRoom(AUDIT_ROOM, "audit:created", event);
      if (event.actorId) {
        this._emitter.toUser(event.actorId, "audit:created", event);
      }
    });
  }
}
