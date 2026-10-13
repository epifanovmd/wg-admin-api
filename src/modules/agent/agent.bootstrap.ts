import { inject } from "inversify";

import { config } from "../../config";
import { HttpServer, IBootstrap, Injectable, logger } from "../../core";
import { agentConfig } from "./agent.config";
import { AgentRuntime } from "./agent.runtime";
import { AgentWatchService } from "./agent-watch.service";

/**
 * Запуск агентов: события SDK, сигналы между процессами; на ролях с HTTP —
 * WebSocket `/api/v1/agent-link` на том же сервере, что API и Socket.IO, и
 * наблюдение за агентами для сокетов. Роль `worker` — без соединений: Store
 * общий, вызовы, которым нужно соединение агента, — `AGENT_ELSEWHERE`.
 */
@Injectable()
export class AgentBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(AgentRuntime) private readonly _runtime: AgentRuntime,
    @inject(AgentWatchService) private readonly _watch: AgentWatchService,
    @inject(HttpServer) private readonly _server: HttpServer,
  ) {}

  async initialize(): Promise<void> {
    await this._runtime.start();

    if (config.app.role === "worker") return;

    this._runtime.agents.attach(this._server);
    this._watch.start();
    logger.info(
      {
        instance: this._runtime.instanceId,
        bootstrapToken: !!agentConfig.bootstrapToken,
        bundleDir: agentConfig.bundleDir ?? null,
        validateEvents: agentConfig.validateEvents,
      },
      "[Agent] Канал агентов готов",
    );
  }

  async destroy(): Promise<void> {
    await this._watch.stop();
    await this._runtime.stop();
  }
}
