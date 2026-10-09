import { inject } from "inversify";

import { IJobHandler, Injectable, JobDefinition, logger } from "../../core";
import { WgNodeService } from "../wg-node";
import { WgAgentSyncService } from "./wg-agent-sync.service";

/** Очередь сверки настроек воркеров всех нод. */
export const WG_AGENT_SYNC_QUEUE = "wg.agent-sync";

/**
 * Раз в 10 минут: настройки воркеров всех нод с агентами сверяются с БД и
 * записываются, если разошлись (сигнал изменения потерялся, процесс
 * перезапускался). Неизменённые ключи не трогаются.
 */
@Injectable()
export class WgAgentSyncJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: WG_AGENT_SYNC_QUEUE,
    cron: "*/10 * * * *",
    retryLimit: 0,
    expireInSeconds: 600,
  };

  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgAgentSyncService) private readonly _sync: WgAgentSyncService,
  ) {}

  async handle(): Promise<void> {
    for (const node of await this._nodes.boundNodes()) {
      await this._sync
        .sync(node.id)
        .catch(err =>
          logger.warn({ err, nodeId: node.id }, "[WG] Сверка настроек ноды"),
        );
    }
  }
}
