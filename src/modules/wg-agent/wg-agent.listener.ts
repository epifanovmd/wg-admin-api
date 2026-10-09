import { inject } from "inversify";

import { EventBus, Injectable, logger } from "../../core";
import { AgentConfigChangedEvent, AgentMetricsReceivedEvent } from "../agent";
import { ISocketEventListener } from "../socket";
import {
  WgNodeCreatedEvent,
  WgNodeDeletedEvent,
  WgNodeHostChangedEvent,
} from "../wg-node";
import { WgAgentSyncService } from "./wg-agent-sync.service";
import { WgAgentTelemetryService } from "./wg-agent-telemetry.service";

/**
 * События агентов → домен: точки метрик (статистика, пробы, маршруты,
 * прокси) и статусы настройки `wg/state` (применённая версия, ошибки,
 * статусы интерфейсов). Появление, удаление и смена адреса ноды меняют цели
 * проб у всех нод — их настройки пересобираются.
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
      AgentConfigChangedEvent,
      guard("Статус настройки агента не принят", ({ status }) =>
        this._telemetry.onConfigStatus(status),
      ),
    );

    const resyncAll = (): void => this._sync.scheduleAll();

    this._eventBus.on(WgNodeCreatedEvent, resyncAll);
    this._eventBus.on(WgNodeDeletedEvent, resyncAll);
    this._eventBus.on(WgNodeHostChangedEvent, resyncAll);
  }
}
