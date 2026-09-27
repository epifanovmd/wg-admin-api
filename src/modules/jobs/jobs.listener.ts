import { inject } from "inversify";

import { EventBus, Injectable } from "../../core";
import { ISocketEventListener, SocketEmitterService } from "../socket";
import { JobUpdatedEvent } from "./events";
import { jobRoom } from "./job-room.policy";

/**
 * `job:updated` — в комнату задачи и в комнату её scope
 * (`<scopeType>_<scopeId>`), а без scope — владельцу.
 */
@Injectable()
export class JobsSocketListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(SocketEmitterService)
    private readonly _emitter: SocketEmitterService,
  ) {}

  register(): void {
    this._eventBus.on(JobUpdatedEvent, ({ job }) => {
      this._emitter.toRoom(jobRoom(job.id), "job:updated", job);

      if (job.scopeType && job.scopeId) {
        this._emitter.toRoom(
          `${job.scopeType}_${job.scopeId}`,
          "job:updated",
          job,
        );
      } else if (job.ownerId) {
        this._emitter.toUser(job.ownerId, "job:updated", job);
      }
    });
  }
}
