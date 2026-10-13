import { inject } from "inversify";

import { config } from "../../config";
import { IBootstrap } from "../bootstrap";
import { Injectable } from "../decorators";
import { logger } from "../logger";
import { agentConfig, agentReleasesDir } from "./agent.config";
import { AgentSignals } from "./agent.signals";
import { AgentStreams } from "./agent-streams";

/**
 * Запуск агентов: сигналы между копиями (ожидание итогов — на всех ролях); на ролях с HTTP —
 * потоки агентов этой копии.
 */
@Injectable()
export class AgentCoreBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(AgentSignals) private readonly _signals: AgentSignals,
    @inject(AgentStreams) private readonly _streams: AgentStreams,
  ) {}

  async initialize(): Promise<void> {
    await this._signals.start();
    if (config.app.role === "worker") return;
    await this._streams.start();
    logger.info(
      {
        instance: this._streams.instanceId,
        bootstrapToken: !!agentConfig.bootstrapToken,
        bundleDir: agentConfig.bundleDir ?? null,
        releases: agentReleasesDir() ?? null,
      },
      "[Agent] Канал агентов готов",
    );
  }

  async destroy(): Promise<void> {
    if (config.app.role !== "worker") await this._streams.stop();
    await this._signals.stop();
  }
}
