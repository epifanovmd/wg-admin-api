import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { wgConfig } from "./wg.config";
import { WgNodeService } from "./wg-node.service";

/** Раз в минуту переводит молчащие ноды в offline (с событием). */
@Injectable()
export class WgNodeOfflineJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.node-offline",
    cron: "* * * * *",
    retryLimit: 1,
  };

  constructor(@inject(WgNodeService) private readonly _nodes: WgNodeService) {}

  async handle(): Promise<void> {
    const changed = await this._nodes.sweepSilentAgents(
      wgConfig.agentOfflineAfterSec,
    );

    if (changed > 0) {
      logger.warn({ changed }, "[WG] silent nodes marked offline");
    }
  }
}
