import { inject } from "inversify";

import { IHealthIndicator, Injectable } from "../../core";
import { PgBossService } from "./pg-boss.service";

/** `/health`: очередь задач запущена (pg-boss подключён к БД). */
@Injectable()
export class JobsHealthIndicator implements IHealthIndicator {
  readonly name = "jobs";

  constructor(@inject(PgBossService) private readonly _boss: PgBossService) {}

  async check(): Promise<boolean> {
    return this._boss.isStarted;
  }
}
