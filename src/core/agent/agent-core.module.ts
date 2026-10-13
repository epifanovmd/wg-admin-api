import { Module } from "../decorators";
import { asJobHandler, EXTERNAL_JOB_EXECUTOR } from "../jobs";
import { RAW_HTTP_HANDLER } from "../routing";
import { Agent } from "./agent.entity";
import { AgentRepository } from "./agent.repository";
import { AgentSignals } from "./agent.signals";
import { AgentCommand } from "./agent-command.entity";
import { AgentCommandRepository } from "./agent-command.repository";
import { AgentConfig } from "./agent-config.entity";
import { AgentConfigRepository } from "./agent-config.repository";
import { AgentCoreBootstrap } from "./agent-core.bootstrap";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AgentEnrollmentToken } from "./agent-enrollment-token.entity";
import { AgentEnrollmentTokenRepository } from "./agent-enrollment-token.repository";
import { AgentEvent } from "./agent-event.entity";
import { AgentEventRepository } from "./agent-event.repository";
import { AgentJobExecutor } from "./agent-job.executor";
import { AgentLinkHandler } from "./agent-link.handler";
import { AgentMetric } from "./agent-metric.entity";
import { AgentMetricRepository } from "./agent-metric.repository";
import { AgentProtocolService } from "./agent-protocol.service";
import { AgentPruneJob } from "./agent-prune.job";
import { AgentStreams } from "./agent-streams";
import { Agents } from "./agents.service";

/**
 * Агенты в ядре (github.com/epifanovmd/agent, протокол — docs/PROTOCOL.md агента): сторона
 * бэкенда протокола (`/agent/v1/*`), хранилище, API для модулей (`Agents`), внешние задачи на
 * воркерах (`EXTERNAL_JOB_EXECUTOR`). О проекте не знает — переносится как есть; REST и
 * сокеты для веба — модуль `agent`.
 */
@Module({
  entities: [
    Agent,
    AgentConfig,
    AgentCommand,
    AgentEvent,
    AgentMetric,
    AgentEnrollmentToken,
  ],
  providers: [
    AgentRepository,
    AgentConfigRepository,
    AgentCommandRepository,
    AgentEventRepository,
    AgentMetricRepository,
    AgentEnrollmentTokenRepository,
    AgentSignals,
    AgentEnrollmentService,
    Agents,
    AgentProtocolService,
    AgentStreams,
    { provide: RAW_HTTP_HANDLER, useClass: AgentLinkHandler },
    { provide: EXTERNAL_JOB_EXECUTOR, useClass: AgentJobExecutor },
    asJobHandler(AgentPruneJob),
  ],
  bootstrappers: [AgentCoreBootstrap],
})
export class AgentCoreModule {}
