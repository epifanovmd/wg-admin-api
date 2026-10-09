import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { AgentService } from "../agent";
import { WgNodeService } from "../wg-node";
import { WgViewerDemandService } from "../wg-stats";

/** Id наблюдателя модуля у агента. */
export const WG_VIEWERS_WATCH_ID = "wg-viewers";

/** Наблюдение за агентами нод, пока открыта админка. */
export const WG_VIEWERS_WATCH = {
  /** Частота метрик (живая статистика), мс. */
  metricsIntervalMs: 1_000,
  /** Срок наблюдателя без продления, мс. */
  ttlMs: 30_000,
  /** Пересмотр спроса и продление, мс. */
  checkMs: 5_000,
  /** Продление не реже, мс (меньше срока). */
  renewMs: 15_000,
};

/**
 * Живая статистика по спросу: пока админку смотрят (сокеты в любом
 * процессе, `WgViewerDemandService`), агенты нод на связи с этим процессом
 * присылают метрики раз в секунду (`watch`); без зрителей — с обычной
 * частотой (`AGENT_METRICS_INTERVAL_MS`). Наблюдатель продлевается, снимается
 * при уходе зрителей, процесс упал — истекает сам.
 */
@Injectable()
export class WgAgentWatchService {
  private _timer: NodeJS.Timeout | null = null;
  /** Агенты с наблюдателем и когда он продлён, мс. */
  private readonly _watched = new Map<string, number>();
  private _checking = false;

  constructor(
    @inject(AgentService) private readonly _agents: AgentService,
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgViewerDemandService)
    private readonly _demand: WgViewerDemandService,
  ) {}

  start(): void {
    this._timer ??= setInterval(
      () => void this.check(),
      WG_VIEWERS_WATCH.checkMs,
    );
    this._timer.unref();
  }

  async stop(): Promise<void> {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;

    const ids = [...this._watched.keys()];

    this._watched.clear();
    await Promise.allSettled(
      ids.map(id => this._agents.unwatch(id, WG_VIEWERS_WATCH_ID)),
    );
  }

  /** Пересмотреть спрос и наблюдателей. */
  async check(now = Date.now()): Promise<void> {
    if (this._checking) return;
    this._checking = true;

    try {
      const watched = await this._demand.isWatched();
      const want = watched ? await this._localNodeAgents() : new Set<string>();

      for (const [agentId] of this._watched) {
        if (!want.has(agentId)) {
          this._watched.delete(agentId);
          await this._agents
            .unwatch(agentId, WG_VIEWERS_WATCH_ID)
            .catch(() => undefined);
        }
      }
      for (const agentId of want) {
        const renewedAt = this._watched.get(agentId);

        if (
          renewedAt !== undefined &&
          now - renewedAt < WG_VIEWERS_WATCH.renewMs
        ) {
          continue;
        }

        try {
          await this._agents.watch(agentId, {
            id: WG_VIEWERS_WATCH_ID,
            metricsIntervalMs: WG_VIEWERS_WATCH.metricsIntervalMs,
            ttlMs: WG_VIEWERS_WATCH.ttlMs,
          });
          this._watched.set(agentId, now);
        } catch (err) {
          logger.debug(
            { err, agentId },
            "[WG] Наблюдение за агентом не началось",
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "[WG] Пересмотр наблюдения за агентами");
    } finally {
      this._checking = false;
    }
  }

  /** Агенты нод на связи с этим процессом. */
  private async _localNodeAgents(): Promise<Set<string>> {
    const [local, bound] = await Promise.all([
      this._agents.localAgentIds(),
      this._nodes.boundNodes(),
    ]);
    const nodeAgents = new Set(bound.map(node => node.agentId));

    return new Set(local.filter(id => nodeAgents.has(id)));
  }
}
