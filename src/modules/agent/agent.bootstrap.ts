import { inject } from "inversify";

import { config } from "../../config";
import { HttpServer, IBootstrap, Injectable, logger } from "../../core";
import { agentConfig } from "./agent.config";
import { AgentRuntime } from "./agent.runtime";
import { AgentRelayServer } from "./agent-relay.server";
import { AgentWatchService } from "./agent-watch.service";

/**
 * Запуск агентов: события SDK, сигналы между процессами; на ролях с HTTP —
 * WebSocket `/api/v1/agent-link` на том же сервере, что API и Socket.IO,
 * наблюдение за агентами для сокетов и (с `AGENT_RELAY_SECRET`) внутренний
 * сервер пересылки на своём порту. Роль `worker` — без соединений и без
 * сервера пересылки: Store общий, вызовы агентов — пересылкой в копию с
 * соединением.
 */
@Injectable()
export class AgentBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(AgentRuntime) private readonly _runtime: AgentRuntime,
    @inject(AgentWatchService) private readonly _watch: AgentWatchService,
    @inject(AgentRelayServer) private readonly _relay: AgentRelayServer,
    @inject(HttpServer) private readonly _server: HttpServer,
  ) {}

  async initialize(): Promise<void> {
    await this._runtime.start();

    if (config.app.role === "worker") return;

    this._runtime.agents.attach(this._server);
    this._watch.start();
    await this._relay.start();
    logger.info(
      {
        instance: this._runtime.instanceId,
        relay: this._relay.address,
        bootstrapToken: !!agentConfig.bootstrapToken,
        releasesDir: agentConfig.releasesDir ?? null,
        validateEvents: agentConfig.validateEvents,
      },
      "[Agent] Канал агентов готов",
    );
  }

  async destroy(): Promise<void> {
    await this._relay.stop();
    await this._watch.stop();
    await this._runtime.stop();
  }
}
