import { inject } from "inversify";

import { Injectable } from "../decorators";
import { EventBus } from "../event-bus";
import { HttpException } from "../http";
import {
  ExternalJobAssignment,
  ExternalJobDispatch,
  ExternalJobUpdate,
  IExternalJobExecutor,
  JobError,
} from "../jobs";
import { AgentError } from "./agent.errors";
import {
  AgentCommandFinishedEvent,
  AgentCommandProgressEvent,
  AgentConnectedEvent,
} from "./agent.events";
import { AgentCommand } from "./agent-command.entity";
import { Agents } from "./agents.service";
import { AgentCommandType, AgentProtocolCode } from "./protocol";

/** Аргументы команды воркеру для внешней задачи. */
export interface IAgentJobArgs {
  jobId: string;
  data: unknown;
  files?: { inputs?: Record<string, string>; outputs?: Record<string, string> };
}

const jobIdOf = (command: AgentCommand): string | undefined =>
  (command.args as { args?: IAgentJobArgs } | null)?.args?.jobId;

/**
 * Внешние задачи (`EXTERNAL_JOB_EXECUTOR`) — команды воркерам агентов: тип задачи — команда
 * из `manifest.commands` воркера, аргументы — `{ jobId, data, files }`, ход — события
 * `command.progress`, итог — итог команды. Команда — запись в БД: передать задачу может любая
 * копия API или процесс задач.
 */
@Injectable()
export class AgentJobExecutor implements IExternalJobExecutor {
  readonly canDispatch = true;

  private readonly _updates = new Set<
    (update: ExternalJobUpdate) => Promise<void>
  >();
  private readonly _reconnects = new Set<(agentId: string) => void>();

  constructor(
    @inject(Agents) private readonly _agents: Agents,
    @inject(EventBus) bus: EventBus,
  ) {
    bus.on(AgentCommandFinishedEvent, e => this.emit(e.command));
    bus.on(AgentCommandProgressEvent, e => this.emit(e.command));
    bus.on(AgentConnectedEvent, e => {
      for (const listener of this._reconnects) listener(e.agent.id);
    });
  }

  /** Воркер на связи, объявивший команду; свободные (не `busy`) — первыми. */
  async dispatch(job: ExternalJobDispatch): Promise<ExternalJobUpdate> {
    const now = Date.now();
    const candidates = (await this._agents.all())
      .filter(agent => this._agents.isOnline(agent, now))
      .flatMap(agent =>
        this._agents
          .workers(agent)
          .filter(w => w.state === "running")
          .filter(w => !job.target.worker || w.name === job.target.worker)
          .filter(w =>
            w.manifest?.commands?.some(c => c.type === job.target.type),
          )
          .map(worker => ({ agent, worker })),
      );

    if (!candidates.length) {
      throw new JobError(
        "NO_AGENT",
        `Нет агента на связи с воркером, выполняющим ${job.target.type}`,
        true,
      );
    }
    const free = candidates.filter(c => !c.worker.health?.busy);
    const pool = free.length ? free : candidates;
    const { agent, worker } = pool[Math.floor(Math.random() * pool.length)];
    const args: IAgentJobArgs = {
      jobId: job.jobId,
      data: job.data,
      files: job.files,
    };
    const command = await this._agents
      .workerCommand(agent.id, worker.name, job.target.type, args, {
        id: `${job.jobId}.${job.attempt}`,
        job: true,
      })
      .catch((err: unknown) => {
        // data не по схеме команды — повтор не поможет.
        if (
          err instanceof HttpException &&
          err.code === AgentError.codes.COMMAND_INVALID
        ) {
          throw new JobError(
            err.code,
            `${err.message}: ${String((err.reason as { reason?: string } | undefined)?.reason ?? "")}`,
            false,
          );
        }
        throw err;
      });

    return {
      kind: "progress",
      agentId: agent.id,
      worker: worker.name,
      workId: command.id,
      jobId: job.jobId,
      progress: 0,
    };
  }

  async poll(
    assignment: ExternalJobAssignment,
  ): Promise<ExternalJobUpdate | null> {
    const command = await this._agents.findCommand(assignment.workId);

    return command ? this.toUpdate(command) : null;
  }

  async cancel(assignment: ExternalJobAssignment): Promise<void> {
    await this._agents.cancelWorkerCommand(
      assignment.agentId,
      assignment.worker,
      assignment.workId,
    );
  }

  onUpdate(listener: (update: ExternalJobUpdate) => Promise<void>): () => void {
    this._updates.add(listener);

    return () => this._updates.delete(listener);
  }

  onReconnect(listener: (agentId: string) => void): () => void {
    this._reconnects.add(listener);

    return () => this._reconnects.delete(listener);
  }

  private async emit(command: AgentCommand): Promise<void> {
    if (command.type !== AgentCommandType.WORKER_COMMAND || !jobIdOf(command))
      return;
    const update = this.toUpdate(command);

    for (const listener of this._updates) await listener(update);
  }

  private toUpdate(command: AgentCommand): ExternalJobUpdate {
    const base = {
      agentId: command.agentId,
      worker: command.worker ?? "",
      workId: command.id,
      jobId: jobIdOf(command),
    };

    if (command.status === "pending") {
      return {
        ...base,
        kind: "progress",
        progress: command.progress ?? 0,
        text: command.progressText ?? undefined,
      };
    }
    if (command.ok) return { ...base, kind: "done", result: command.result };
    if (command.error?.code === AgentProtocolCode.CANCELLED)
      return { ...base, kind: "cancelled" };

    return {
      ...base,
      kind: "failed",
      error: command.error ?? { code: "UNKNOWN", message: "итог без ошибки" },
    };
  }
}
