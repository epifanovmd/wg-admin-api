import type { AgentEvent } from "agent-sdk/server";
import { inject } from "inversify";

import { IBootstrap, Injectable } from "../../core";
import { AgentService } from "../agent";
import { WG_WORKER } from "../wg-node";
import { WgAgentSyncService } from "./wg-agent-sync.service";
import { WgAgentTelemetryService } from "./wg-agent-telemetry.service";
import { WgAgentWatchService } from "./wg-agent-watch.service";
import { WG_NODE_CHANGED_CHANNEL, WgNodeSignals } from "./wg-node-signals";
import {
  WG_EVENT_ROUTE_CHANGED,
  WG_EVENT_STATE_RESULT,
} from "./wg-worker.contract";

/**
 * Запуск связи домена с агентами: события воркера wg (итог повтора
 * применения, смена маршрутов) — до подтверждения агенту; на процессах с
 * соединениями агентов — сигналы изменения нод (`wg_node_changed` после
 * коммита) → запись настроек воркеров, наблюдение по спросу зрителей,
 * сверка всех нод при старте.
 */
@Injectable()
export class WgAgentBootstrap implements IBootstrap {
  readonly critical = false;

  private _offEvents: (() => void) | null = null;
  private _offSignal: (() => void) | null = null;

  constructor(
    @inject(AgentService) private readonly _agents: AgentService,
    @inject(WgNodeSignals) private readonly _signals: WgNodeSignals,
    @inject(WgAgentSyncService) private readonly _sync: WgAgentSyncService,
    @inject(WgAgentWatchService) private readonly _watch: WgAgentWatchService,
    @inject(WgAgentTelemetryService)
    private readonly _telemetry: WgAgentTelemetryService,
  ) {}

  async initialize(): Promise<void> {
    this._offEvents = this._agents.onWorkerEvent(event =>
      this._onWorkerEvent(event),
    );

    if (!this._agents.hasConnections) return;

    this._offSignal = this._signals.on(WG_NODE_CHANGED_CHANNEL, nodeId =>
      this._sync.schedule(nodeId),
    );
    await this._signals.start();
    this._watch.start();
    this._sync.scheduleAll();
  }

  async destroy(): Promise<void> {
    this._offEvents?.();
    this._offSignal?.();
    this._sync.stop();
    await this._watch.stop();
    await this._signals.stop();
  }

  private async _onWorkerEvent(event: AgentEvent): Promise<void> {
    if (event.worker !== WG_WORKER) return;

    if (event.type === WG_EVENT_STATE_RESULT) {
      await this._telemetry.onStateResult(event.agentId, event.data);
    } else if (event.type === WG_EVENT_ROUTE_CHANGED) {
      await this._telemetry.onRouteChanged(event.agentId, event.data);
    }
  }
}
