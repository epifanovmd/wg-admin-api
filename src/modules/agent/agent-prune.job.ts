import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { AGENT_PRUNE_QUEUE } from "./agent.types";
import { AgentHistoryService } from "./agent-history.service";

/** Раз в час: события воркеров старше срока хранения. */
@Injectable()
export class AgentPruneJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: AGENT_PRUNE_QUEUE,
    cron: "15 * * * *",
    retryLimit: 1,
    expireInSeconds: 600,
  };

  constructor(
    @inject(AgentHistoryService) private readonly _history: AgentHistoryService,
  ) {}

  async handle(): Promise<void> {
    const removed = await this._history.prune();

    if (removed.events) {
      logger.info(removed, "[Agent] История агентов убрана по сроку");
    }
  }
}
