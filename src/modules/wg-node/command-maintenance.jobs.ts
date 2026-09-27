import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { WgNodeCommandService } from "./wg-node-command.service";

/** Раз в минуту закрывает команды, не выполненные в срок. */
@Injectable()
export class WgCommandTimeoutJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.command-timeout",
    cron: "* * * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
  ) {}

  async handle(): Promise<void> {
    const closed = await this._commands.sweepExpired();

    if (closed > 0) {
      logger.warn({ closed }, "[WG] node commands timed out");
    }
  }
}

/** Ежедневно удаляет завершённые команды старше срока хранения. */
@Injectable()
export class WgCommandRetentionJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.command-retention",
    cron: "20 3 * * *",
    retryLimit: 1,
  };

  constructor(
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
  ) {}

  async handle(): Promise<void> {
    const deleted = await this._commands.purgeFinished();

    if (deleted > 0) {
      logger.info({ deleted }, "[WG] old node commands removed");
    }
  }
}
