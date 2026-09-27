import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { WgPeerService } from "./wg-peer.service";

/** Раз в минуту отключает пиров с истёкшим сроком действия. */
@Injectable()
export class WgPeerExpiryJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: "wg.peer-expiry",
    cron: "* * * * *",
    retryLimit: 1,
  };

  constructor(@inject(WgPeerService) private readonly _peers: WgPeerService) {}

  async handle(): Promise<void> {
    const disabled = await this._peers.disableExpired();

    if (disabled > 0) {
      logger.info({ disabled }, "[WG] expired peers disabled");
    }
  }
}
