import { inject } from "inversify";

import {
  AgentConfigAppliedEvent,
  AgentEventReceivedEvent,
  AgentMetricsReceivedEvent,
  EventBus,
  Injectable,
  logger,
} from "../../core";
import { ISocketEventListener } from "../socket";
import {
  WG_WORKER,
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeHostChangedEvent,
} from "../wg-node";
import { WgAgentSyncService } from "./wg-agent-sync.service";
import { WgAgentTelemetryService } from "./wg-agent-telemetry.service";
import {
  WG_EVENT_NODE_INFO,
  WG_EVENT_ROUTE_CHANGED,
  WG_EVENT_STATE_RESULT,
} from "./wg-worker.contract";

/**
 * События агентов → домен: точки метрик (статистика, пробы, маршруты,
 * прокси), отказ воркера в настройке `wg/state`, события воркера wg (итог
 * применения, смена маршрутов, сведения об узле). Появление, удаление и смена
 * адреса ноды меняют цели проб у всех нод — их настройки пересобираются.
 */
@Injectable()
export class WgAgentListener implements ISocketEventListener {
  constructor(
    @inject(EventBus) private readonly _eventBus: EventBus,
    @inject(WgAgentTelemetryService)
    private readonly _telemetry: WgAgentTelemetryService,
    @inject(WgAgentSyncService) private readonly _sync: WgAgentSyncService,
  ) {}

  register(): void {
    const guard =
      <T>(what: string, fn: (event: T) => Promise<void>) =>
      (event: T): Promise<void> =>
        fn(event).catch(err => logger.warn({ err }, `[WG] ${what}`));

    this._eventBus.on(
      AgentMetricsReceivedEvent,
      guard("Метрики агента не приняты", ({ agentId, point }) =>
        this._telemetry.onMetrics(agentId, point),
      ),
    );
    this._eventBus.on(
      AgentConfigAppliedEvent,
      guard("Итог настройки агента не принят", event =>
        this._telemetry.onConfigApplied(event),
      ),
    );
    this._eventBus.on(
      AgentEventReceivedEvent,
      guard("Событие воркера wg не принято", ({ agentId, event }) =>
        this._onWorkerEvent(agentId, event.worker, event.type, event.data),
      ),
    );

    const resyncAll = (): void => this._sync.scheduleAll();

    this._eventBus.on(WgNodeCreatedEvent, resyncAll);
    this._eventBus.on(WgNodeDeletedEvent, resyncAll);
    this._eventBus.on(WgNodeHostChangedEvent, resyncAll);
  }

  private async _onWorkerEvent(
    agentId: string,
    worker: string,
    type: string,
    data: unknown,
  ): Promise<void> {
    if (worker !== WG_WORKER) return;

    if (type === WG_EVENT_STATE_RESULT) {
      await this._telemetry.onStateResult(agentId, data);
    } else if (type === WG_EVENT_ROUTE_CHANGED) {
      await this._telemetry.onRouteChanged(agentId, data);
    } else if (type === WG_EVENT_NODE_INFO) {
      await this._telemetry.onNodeInfo(agentId, data);
    }
  }
}
