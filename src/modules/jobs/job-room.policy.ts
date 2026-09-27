import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { JobsService } from "./jobs.service";

/** Комната задачи `job_<id>`: владелец или разрешённые политикой scope. */
export const jobRoom = (id: string): string => `job_${id}`;

@Injectable()
export class JobRoomPolicy implements ISocketRoomPolicy {
  readonly type = "job";

  constructor(@inject(JobsService) private readonly _jobs: JobsService) {}

  room(id: string): string {
    return jobRoom(id);
  }

  canJoin(userId: string, id: string): Promise<boolean> {
    return this._jobs.canView(userId, id);
  }
}
