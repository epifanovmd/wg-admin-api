import { inject } from "inversify";

import { Agents, Injectable, logger } from "../../core";
import { WgNodeService } from "../wg-node";
import { WgViewerDemandService } from "../wg-stats";

/** Наблюдение за агентами нод, пока открыта админка. */
export const WG_VIEWERS_WATCH = {
  /** Частота метрик (живая статистика), мс. */
  metricsIntervalMs: 1_000,
  /** Срок наблюдения без продления, мс. */
  ttlMs: 30_000,
  /** Пересмотр спроса, мс. */
  checkMs: 5_000,
  /** Продлевать, когда до конца срока осталось меньше, мс. */
  renewBeforeMs: 15_000,
};

/**
 * Живая статистика по спросу: пока админку смотрят (сокеты в любом процессе,
 * `WgViewerDemandService`), агенты нод под наблюдением (`watch` в желаемом
 * агента): метрики раз в секунду, воркеры шлют пульс с той же частотой. Срок
 * продлевается, пока зрители есть; ушли — наблюдение истекает само. Уровень
 * журнала, выставленный страницей агента, сохраняется. Желаемое — в БД, так
 * что пересмотр в нескольких процессах сходится к одному.
 */
@Injectable()
export class WgAgentWatchService {
  private _timer: NodeJS.Timeout | null = null;
  private _checking = false;

  constructor(
    @inject(Agents) private readonly _agents: Agents,
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

  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** Пересмотреть спрос и продлить наблюдение за агентами нод. */
  async check(now = Date.now()): Promise<void> {
    if (this._checking) return;
    this._checking = true;

    try {
      if (!(await this._demand.isWatched())) return;

      for (const node of await this._nodes.boundNodes()) {
        await this._renew(node.agentId, now).catch(err =>
          logger.debug(
            { err, agentId: node.agentId },
            "[WG] Наблюдение за агентом не продлено",
          ),
        );
      }
    } catch (err) {
      logger.warn({ err }, "[WG] Пересмотр наблюдения за агентами");
    } finally {
      this._checking = false;
    }
  }

  private async _renew(agentId: string, now: number): Promise<void> {
    const agent = await this._agents.find(agentId);

    if (!agent || agent.revokedAt || !this._agents.isOnline(agent)) return;

    const current =
      agent.watch?.until && agent.watch.until > now ? agent.watch : null;

    if (
      current &&
      current.until! - now > WG_VIEWERS_WATCH.renewBeforeMs &&
      (current.metricsIntervalMs ?? Infinity) <=
        WG_VIEWERS_WATCH.metricsIntervalMs
    ) {
      return;
    }

    await this._agents.setWatch(agentId, {
      metricsIntervalMs: WG_VIEWERS_WATCH.metricsIntervalMs,
      ...(current?.logLevel && { logLevel: current.logLevel }),
      until: now + WG_VIEWERS_WATCH.ttlMs,
    });
  }
}
