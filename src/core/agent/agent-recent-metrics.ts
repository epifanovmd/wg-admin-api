import { Injectable } from "../decorators";
import { getRedis } from "../redis";
import { agentConfig } from "./agent.config";
import type { IAgentMetrics } from "./protocol";

const KEY = "agent-recent-metrics:";

/**
 * Свежие точки метрик агентов — каждая полученная, за последние `AGENT_METRICS_RECENT_MINUTES`
 * (история в БД — не чаще `AGENT_METRICS_STORE_INTERVAL_MS`): график последних минут после
 * перезагрузки страницы — с той же частотой, что и живые точки. Redis — общий для копий API (без
 * него — память процесса).
 */
@Injectable()
export class AgentRecentMetrics {
  private readonly _redis = getRedis();
  private readonly _mem = new Map<string, IAgentMetrics[]>();

  /** Окно, мс. */
  get windowMs(): number {
    return agentConfig.metricsRecentMinutes * 60_000;
  }

  async add(agentId: string, points: IAgentMetrics[]): Promise<void> {
    if (!points.length) return;
    const from = Date.now() - this.windowMs;

    if (this._redis) {
      const key = KEY + agentId;
      const args = points.flatMap(p => [p.at, JSON.stringify(p)]);

      await this._redis
        .multi()
        .zadd(key, ...args)
        .zremrangebyscore(key, "-inf", `(${from}`)
        .pexpire(key, this.windowMs)
        .exec();

      return;
    }

    const list = [...(this._mem.get(agentId) ?? []), ...points].filter(
      p => p.at >= from,
    );

    this._mem.set(agentId, list);
  }

  /** Точки агента в [since, until] по времени. */
  async range(
    agentId: string,
    since: number,
    until: number,
  ): Promise<IAgentMetrics[]> {
    if (this._redis) {
      const raw = await this._redis.zrangebyscore(KEY + agentId, since, until);

      return raw.map(r => JSON.parse(r) as IAgentMetrics);
    }

    return (this._mem.get(agentId) ?? []).filter(
      p => p.at >= since && p.at <= until,
    );
  }

  async delete(agentId: string): Promise<void> {
    if (this._redis) await this._redis.del(KEY + agentId);
    else this._mem.delete(agentId);
  }
}
