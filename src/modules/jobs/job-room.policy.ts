import { inject } from "inversify";

import { AccessService, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { JobsService } from "./jobs.service";

/** Комната задачи `job_<id>`: суперпользователь, владелец или разрешённые политикой scope. */
export const jobRoom = (id: string): string => `job_${id}`;

@Injectable()
export class JobRoomPolicy implements ISocketRoomPolicy {
  readonly type = "job";

  constructor(
    @inject(JobsService) private readonly _jobs: JobsService,
    @inject(AccessService) private readonly _access: AccessService,
  ) {}

  room(id: string): string {
    return jobRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    return this._jobs.canView(
      userId,
      id,
      await this._access.isSuperUser(userId),
    );
  }
}
