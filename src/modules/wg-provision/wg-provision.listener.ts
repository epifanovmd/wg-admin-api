import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { EJobRunStatus, JobUpdatedEvent } from "../jobs";
import type { ISocketEventListener } from "../socket";
import { WgNodeService } from "../wg-node";
import { WG_NODE_JOB_SCOPE, WG_PROVISION_QUEUE } from "./wg-provision.types";

const FAILED_STATUSES: readonly EJobRunStatus[] = [
  EJobRunStatus.FAILED,
  EJobRunStatus.CANCELLED,
];

/**
 * Установка завершилась неудачей без catch задачи (воркер упал — запись
 * закрыл reaper, или задачу отменили): нода не должна остаться в
 * `provisioning`. Слушатель работает на всех ролях процесса.
 */
@Injectable()
export class WgProvisionListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
  ) {}

  register(): void {
    this._eventBus.on(JobUpdatedEvent, ({ job }) => {
      if (
        job.queue !== WG_PROVISION_QUEUE ||
        !FAILED_STATUSES.includes(job.status) ||
        job.scopeType !== WG_NODE_JOB_SCOPE ||
        !job.scopeId
      ) {
        return;
      }

      this._nodes
        .failProvisioning(job.scopeId)
        .catch(err =>
          logger.warn(
            { err, nodeId: job.scopeId },
            "[WG] provision failure status not applied",
          ),
        );
    });
  }
}
