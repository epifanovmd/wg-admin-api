import { inject } from "inversify";

import { Injectable } from "../decorators";
import { EventBus } from "../event-bus";
import { IJobHandler, JobDefinition } from "../jobs";
import { logger } from "../logger";
import { agentConfig } from "./agent.config";
import { AgentCommandFinishedEvent } from "./agent.events";
import { AgentCommandRepository } from "./agent-command.repository";
import { AgentEventRepository } from "./agent-event.repository";
import { AgentMetricRepository } from "./agent-metric.repository";
import { AgentProtocolCode } from "./protocol";

/** Очередь уборки агентов. */
export const AGENT_PRUNE_QUEUE = "agents.prune";

/** Команда с истёкшим сроком, которую агент так и не забрал, — `EXPIRED` спустя час. */
const EXPIRED_GRACE_MS = 60 * 60_000;

/**
 * Раз в час: события и выполненные команды старше `AGENT_EVENTS_RETENTION_DAYS`, история
 * метрик старше `AGENT_METRICS_RETENTION_HOURS`; ждущие команды с давно истёкшим сроком
 * получают итог `EXPIRED`.
 */
@Injectable()
export class AgentPruneJob implements IJobHandler {
  readonly definition: JobDefinition = {
    queue: AGENT_PRUNE_QUEUE,
    cron: "15 * * * *",
    retryLimit: 1,
    expireInSeconds: 600,
  };

  constructor(
    @inject(AgentEventRepository)
    private readonly _events: AgentEventRepository,
    @inject(AgentMetricRepository)
    private readonly _metrics: AgentMetricRepository,
    @inject(AgentCommandRepository)
    private readonly _commands: AgentCommandRepository,
    @inject(EventBus) private readonly _bus: EventBus,
  ) {}

  async handle(): Promise<void> {
    const now = Date.now();
    const keep = agentConfig.eventsRetentionDays * 24 * 3_600_000;

    await this._events.deleteReceivedBefore(now - keep);
    await this._commands.deleteFinishedBefore(new Date(now - keep));
    await this._metrics.deleteBefore(
      now - agentConfig.metricsRetentionHours * 3_600_000,
    );

    const stale = await this._commands
      .createQueryBuilder("c")
      .where("c.status = 'pending'")
      .andWhere("c.deadline_at < :at", { at: new Date(now - EXPIRED_GRACE_MS) })
      .getMany();

    for (const command of stale) {
      const error = {
        code: AgentProtocolCode.EXPIRED,
        message: "агент не забрал команду до срока",
      };

      if (await this._commands.finish(command.id, false, null, error)) {
        await this._bus.emitAsync(
          new AgentCommandFinishedEvent(
            Object.assign(command, { status: "done", ok: false, error }),
          ),
        );
      }
    }
    if (stale.length)
      logger.info(
        { expired: stale.length },
        "[Agent] Просроченные команды закрыты",
      );
  }
}
