import { inject } from "inversify";

import {
  Agent,
  agentConfig,
  AgentEnrollmentService,
  AgentError,
  agentInstallCommand,
  AgentIssueService,
  agentPublicUrl,
  Agents,
  compareAgentVersions,
  EventBus,
  IAgentIssueInput,
  ICursorPageDto,
  Injectable,
  IPaginatedDto,
  normalizePagination,
  TAgentInstallMode,
  toPage,
} from "../../core";
import { AgentPermissions } from "./agent.permissions";
import { AGENT_COMMAND_WAIT } from "./agent.types";
import {
  AgentAccessService,
  IAgentActor,
  inScope,
} from "./agent-access.service";
import {
  agentAlerts,
  AgentCommandDto,
  AgentConfigDto,
  AgentDto,
  AgentEnrollmentTokenDto,
  IAgentEventDto,
  IAgentInstallOptionsDto,
  IAgentIssuedEnvDto,
  IAgentIssuedLinkDto,
  IAgentLogsDto,
  IAgentMetricsPointDto,
  IAgentReleaseDto,
  ICreatedAgentEnrollmentTokenDto,
  toCommandDto,
  toConfigDto,
  toEventDto,
  toLogEntryDto,
  toMetricDto,
  toTokenDto,
  toWorkerDto,
} from "./dto";
import { AgentActionAuditedEvent } from "./events";

export interface IAgentEventsQuery {
  agentId?: string;
  worker?: string;
  type?: string;
  /** `<receivedAt>.<id>` последнего на прошлой странице. */
  cursor?: string;
  limit?: number;
}

const parseCursor = (
  cursor?: string,
): { receivedAt: number; id: string } | undefined => {
  if (!cursor) return undefined;
  const dot = cursor.indexOf(".");
  const receivedAt = Number(cursor.slice(0, dot));

  return dot > 0 && Number.isFinite(receivedAt)
    ? { receivedAt, id: cursor.slice(dot + 1) }
    : undefined;
};

/**
 * Агенты для веба: доступ (права модуля или политики), DTO, действия пользователя с аудитом.
 * Сама работа с агентами — `Agents` ядра.
 */
/** Срок выданного токена и одноразовой ссылки по умолчанию, мин (сутки). */
export const AGENT_ISSUE_TTL_MINUTES = 24 * 60;

/** Запрос выдачи агента: имя, метки, число регистраций, срок токена, адрес бэкенда. */
export interface IAgentIssueRequest {
  name?: string;
  labels?: Record<string, string>;
  maxUses?: number;
  expiresInMinutes?: number;
  baseUrl?: string;
  /** Имя токена в списке токенов; нет — по имени агента. */
  tokenName?: string;
}

const issueInput = (request: IAgentIssueRequest): IAgentIssueInput => ({
  tokenName: request.tokenName ?? `выдача: ${request.name ?? "агент"}`,
  name: request.name,
  labels: request.labels,
  maxUses: request.maxUses,
  tokenTtlMinutes: request.expiresInMinutes ?? AGENT_ISSUE_TTL_MINUTES,
  server: request.baseUrl,
});

@Injectable()
export class AgentService {
  constructor(
    @inject(Agents) private readonly _agents: Agents,
    @inject(AgentAccessService) private readonly _access: AgentAccessService,
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
    @inject(AgentIssueService) private readonly _issue: AgentIssueService,
    @inject(EventBus) private readonly _bus: EventBus,
  ) {}

  // ─── для других модулей (без проверки прав) ──────────────────────────

  async find(id: string): Promise<AgentDto | null> {
    const agent = await this._agents.find(id);

    return agent ? this.toDto(agent) : null;
  }

  async all(): Promise<AgentDto[]> {
    return Promise.all((await this._agents.all()).map(a => this.toDto(a)));
  }

  /** Итоги настроек агента (без значений); агента нет — пусто. */
  async configStatus(id: string): Promise<AgentConfigDto[]> {
    const agent = await this._agents.find(id);

    return agent
      ? (await this._agents.configStatus(agent)).map(s => toConfigDto(id, s))
      : [];
  }

  /** Агенты, для которых есть новая версия агента или воркера. */
  async updateCandidateIds(): Promise<Set<string>> {
    const dtos = await this.all();

    return new Set(
      dtos
        .filter(
          a => a.updateAvailable || a.workers.some(w => w.updateAvailable),
        )
        .map(a => a.id),
    );
  }

  /** Отозвать от имени `actorId` (агент узла заменён другим). */
  async revokeAs(actorId: string | null, id: string): Promise<void> {
    if (!(await this._agents.find(id))) return;
    await this._agents.revoke(id);
    this.audit(actorId || null, "agent.revoke", id);
  }

  /**
   * Удалить агента от имени `actorId` (узел удалён): запись отозвана, история удалена; агент на
   * узле останавливает воркеры с уборкой и больше не выходит на связь.
   */
  async revokeAndDelete(actorId: string | null, id: string): Promise<void> {
    if (!(await this._agents.find(id))) return;
    await this._agents.delete(id);
    this.audit(actorId, "agent.delete", id);
  }

  publicUrl(): string {
    return agentPublicUrl();
  }

  /** Команда установки; `docker` — только если в архиве агента есть compose.yml. */
  async installCommand(options: {
    token?: string;
    tokenFile?: string;
    name?: string;
    mode?: TAgentInstallMode;
    server?: string;
  }): Promise<string> {
    if (options.mode === "docker") {
      const { archive } = await this._issue.options();

      if (!archive) throw AgentError.ARCHIVE_NOT_FOUND();
      if (!archive.compose) throw AgentError.ARCHIVE_NO_COMPOSE();
    }

    return agentInstallCommand(options);
  }

  async toDto(agent: Agent): Promise<AgentDto> {
    const online = this._agents.isOnline(agent);
    const workers = this._agents.workers(agent);
    const configs = await this._agents.configStatus(agent);
    const latest = agent.state?.update?.latest;
    const version = agent.hello?.agent.version;

    return {
      id: agent.id,
      name: agent.name,
      labels: agent.labels,
      online,
      revoked: !!agent.revokedAt,
      version,
      updateMode: agent.hello?.agent.updateMode,
      install: agent.hello?.agent.install,
      host: agent.hello?.host ?? agent.host ?? undefined,
      remoteIp: agent.remoteIp ?? undefined,
      enrolledAt: agent.enrolledAt.getTime(),
      lastSeenAt: agent.lastSeenAt?.getTime(),
      startedAt: agent.hello?.agent.startedAt,
      updateAvailable:
        latest && version && compareAgentVersions(latest, version) > 0
          ? latest
          : undefined,
      desiredRev: agent.desiredRev,
      appliedRev: agent.state?.desiredRev,
      outbox: agent.state?.outbox,
      workers: workers.map(w => {
        const build = w.release
          ? this._agents.workerBuild(agent, w.name)
          : undefined;

        return toWorkerDto(
          w,
          build &&
            w.version &&
            compareAgentVersions(build.version, w.version) > 0
            ? build.version
            : undefined,
        );
      }),
      metrics: agent.metrics ?? undefined,
      alerts: agent.revokedAt ? [] : agentAlerts(online, workers, configs),
    };
  }

  // ─── REST ────────────────────────────────────────────────────────────

  async list(
    actor: IAgentActor,
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<AgentDto>> {
    const scope = await this._access.scope(actor, "view");
    const page = normalizePagination(offset, limit);
    const all = (await this._agents.all()).filter(a => inScope(scope, a.id));
    const items = await Promise.all(
      all.slice(page.offset, page.offset + page.limit).map(a => this.toDto(a)),
    );

    return toPage(items, all.length, page);
  }

  async get(actor: IAgentActor, id: string): Promise<AgentDto> {
    await this._access.require(actor, id, "view");

    return this.toDto(await this._agents.get(id));
  }

  async events(
    actor: IAgentActor,
    query: IAgentEventsQuery,
  ): Promise<ICursorPageDto<IAgentEventDto>> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    let agentIds: string[] | undefined;

    if (query.agentId) await this._access.require(actor, query.agentId, "view");
    else {
      const scope = await this._access.scope(actor, "view");

      if (scope !== "all") agentIds = [...scope];
    }
    const rows = await this._agents.eventFeed({
      agentId: query.agentId,
      agentIds,
      worker: query.worker,
      type: query.type,
      before: parseCursor(query.cursor),
      limit: limit + 1,
    });
    const items = rows.slice(0, limit).map(toEventDto);
    const last = items[items.length - 1];

    return {
      items,
      nextCursor:
        rows.length > limit && last ? `${last.receivedAt}.${last.id}` : null,
    } as ICursorPageDto<IAgentEventDto>;
  }

  async metrics(
    actor: IAgentActor,
    id: string,
    query: { since?: number; until?: number; limit?: number },
  ): Promise<IAgentMetricsPointDto[]> {
    await this._access.require(actor, id, "view");
    const until = query.until ?? Date.now();
    const since = query.since ?? until - 3_600_000;

    return (
      await this._agents.metrics(
        id,
        since,
        until,
        Math.min(query.limit ?? 1000, 5000),
      )
    ).map(toMetricDto);
  }

  async revoke(actor: IAgentActor, id: string): Promise<AgentDto> {
    await this._access.require(actor, id, "view");
    this._access.requireAll(actor, "manage");
    const agent = await this._agents.revoke(id);

    this.audit(actor.userId, "agent.revoke", id);

    return this.toDto(agent);
  }

  async delete(actor: IAgentActor, id: string): Promise<void> {
    await this._access.require(actor, id, "view");
    this._access.requireAll(actor, "manage");
    await this._agents.delete(id);
    this.audit(actor.userId, "agent.delete", id);
  }

  async rotateKey(actor: IAgentActor, id: string): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "manage");
    const command = await this._agents.rotateKey(id, actor.userId);

    this.audit(actor.userId, "agent.rotateKey", id);

    return toCommandDto(command);
  }

  async update(
    actor: IAgentActor,
    id: string,
    version?: string,
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "manage");
    const command = await this._agents.updateAgent(id, version, actor.userId);

    this.audit(actor.userId, "agent.update", id, {
      version: (command.args as { version?: string })?.version,
    });

    return toCommandDto(command);
  }

  async logs(
    actor: IAgentActor,
    id: string,
    worker?: string,
    lines?: number,
  ): Promise<IAgentLogsDto> {
    await this._access.require(actor, id, "logs");
    const command = await this._agents.logs(id, worker, lines);

    if (!command.ok) {
      throw AgentError.WORKER_NOT_FOUND(
        undefined,
        command.error?.message ?? "Журнал не получен",
      );
    }
    const entries =
      (command.result as { entries?: unknown[] } | null)?.entries ?? [];

    return {
      entries: (entries as Parameters<typeof toLogEntryDto>[0][]).map(
        toLogEntryDto,
      ),
    };
  }

  // ─── воркеры ─────────────────────────────────────────────────────────

  async restartWorker(
    actor: IAgentActor,
    id: string,
    worker: string,
    force = false,
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "manage");
    const command = await this._agents.restartWorker(
      id,
      worker,
      force,
      actor.userId,
    );

    this.audit(actor.userId, "worker.restart", id, { worker, force });

    return toCommandDto(command);
  }

  async updateWorker(
    actor: IAgentActor,
    id: string,
    worker: string,
    version?: string,
    force = false,
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "manage");
    const command = await this._agents.updateWorker(id, worker, {
      version,
      force,
      actor: actor.userId,
    });

    this.audit(actor.userId, "worker.update", id, {
      worker,
      version: (command.args as { version?: string }).version,
    });

    return toCommandDto(command);
  }

  /** Команда воркеру; `waitSeconds` — подождать итог (0 — сразу вернуть поставленную). */
  async workerCommand(
    actor: IAgentActor,
    id: string,
    worker: string,
    body: {
      type: string;
      args?: unknown;
      timeoutMs?: number;
      waitSeconds?: number;
    },
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "command");
    const command = await this._agents.workerCommand(
      id,
      worker,
      body.type,
      body.args,
      {
        timeoutMs: body.timeoutMs,
        actor: actor.userId,
      },
    );

    this.audit(actor.userId, "worker.command", id, { worker, type: body.type });
    const wait = Math.min(
      body.waitSeconds ?? AGENT_COMMAND_WAIT.default,
      AGENT_COMMAND_WAIT.max,
    );
    const done =
      wait > 0 ? await this._agents.wait(command.id, wait * 1000) : null;

    return toCommandDto(done ?? command);
  }

  async cancelCommand(
    actor: IAgentActor,
    id: string,
    commandId: string,
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "command");
    const command = await this._agents.findCommand(commandId);

    if (!command || command.agentId !== id || !command.worker)
      throw AgentError.COMMAND_NOT_FOUND();

    return toCommandDto(
      await this._agents.cancelWorkerCommand(id, command.worker, commandId),
    );
  }

  async commands(
    actor: IAgentActor,
    id: string,
    limit?: number,
  ): Promise<AgentCommandDto[]> {
    await this._access.require(actor, id, "view");

    return (
      await this._agents.recentCommands(id, Math.min(limit ?? 50, 200))
    ).map(toCommandDto);
  }

  async command(
    actor: IAgentActor,
    id: string,
    commandId: string,
    waitSeconds = 0,
  ): Promise<AgentCommandDto> {
    await this._access.require(actor, id, "view");
    let command = await this._agents.findCommand(commandId);

    if (!command || command.agentId !== id)
      throw AgentError.COMMAND_NOT_FOUND();
    if (command.status === "pending" && waitSeconds > 0) {
      command =
        (await this._agents.wait(
          commandId,
          Math.min(waitSeconds, AGENT_COMMAND_WAIT.max) * 1000,
        )) ?? command;
    }

    return toCommandDto(command);
  }

  // ─── настройки ───────────────────────────────────────────────────────

  async configs(actor: IAgentActor, id: string): Promise<AgentConfigDto[]> {
    await this._access.require(actor, id, "view");
    const agent = await this._agents.get(id);
    const withData = await this._access.can(actor, id, "config");
    const statuses = await this._agents.configStatus(agent);

    return Promise.all(
      statuses.map(async s =>
        toConfigDto(
          id,
          s,
          withData
            ? await this._agents.getConfig(id, s.worker, s.key)
            : undefined,
        ),
      ),
    );
  }

  async setConfig(
    actor: IAgentActor,
    id: string,
    worker: string,
    key: string,
    data: unknown,
  ): Promise<AgentConfigDto> {
    await this._access.require(actor, id, "config");
    await this._agents.setConfig(id, worker, key, data, {
      actor: actor.userId,
    });
    this.audit(actor.userId, "config.set", id, { worker, key });
    const status = (
      await this._agents.configStatus(await this._agents.get(id))
    ).find(s => s.worker === worker && s.key === key);

    if (!status) throw AgentError.NOT_FOUND();

    return toConfigDto(id, status, data);
  }

  async deleteConfig(
    actor: IAgentActor,
    id: string,
    worker: string,
    key: string,
  ): Promise<void> {
    await this._access.require(actor, id, "config");
    await this._agents.deleteConfig(id, worker, key, actor.userId);
    this.audit(actor.userId, "config.delete", id, { worker, key });
  }

  // ─── регистрация и сборки ────────────────────────────────────────────

  release(actor: IAgentActor): IAgentReleaseDto {
    this._access.requireAll(actor, "view");
    const manifest = this._agents.releaseManifest();

    return {
      bundle: !!agentConfig.bundleDir,
      workers: (manifest?.workers ?? []).map(w => ({
        name: w.name,
        version: w.version,
        os: w.os,
        arch: w.arch,
      })),
    };
  }

  async createToken(
    actor: IAgentActor,
    body: {
      name: string;
      labels?: Record<string, string>;
      maxUses?: number;
      expiresAt?: Date;
    },
  ): Promise<ICreatedAgentEnrollmentTokenDto> {
    this.requireEnroll(actor);
    const { token, enrollmentToken } = await this._enrollment.createToken(
      actor.userId,
      body,
    );

    return { token, enrollmentToken: toTokenDto(enrollmentToken) };
  }

  async listTokens(
    actor: IAgentActor,
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<AgentEnrollmentTokenDto>> {
    this.requireEnroll(actor);
    const page = await this._enrollment.listTokens(offset, limit);

    return {
      ...page,
      items: page.items.map(toTokenDto),
    } as IPaginatedDto<AgentEnrollmentTokenDto>;
  }

  async revokeToken(actor: IAgentActor, id: string): Promise<void> {
    this.requireEnroll(actor);
    await this._enrollment.revokeToken(id);
  }

  private requireEnroll(actor: IAgentActor): void {
    if (
      !actor.permissions.includes(AgentPermissions.ENROLL) &&
      !actor.permissions.includes("*")
    ) {
      this._access.requireAll(actor, "manage");
    }
  }

  /** Что можно выдать: адрес бэкенда и архив агента (все платформы). */
  async installOptions(actor: IAgentActor): Promise<IAgentInstallOptionsDto> {
    this.requireEnroll(actor);
    const { server, archive } = await this._issue.options();

    return {
      server,
      archive: archive
        ? { ...archive, version: archive.version ?? undefined }
        : undefined,
    };
  }

  /** Токен регистрации и `.env` с ним (показывается один раз). */
  async issueEnv(
    actor: IAgentActor,
    request: IAgentIssueRequest,
  ): Promise<IAgentIssuedEnvDto> {
    this.requireEnroll(actor);
    const issued = await this._issue.env(actor.userId, issueInput(request));

    this.auditIssue(actor.userId, "env", issued.tokenId, request);

    return { ...issued, expiresAt: issued.expiresAt.getTime() };
  }

  /** Архив агента (все платформы) с `.env` (токен — в нём). */
  async issueArchive(
    actor: IAgentActor,
    request: IAgentIssueRequest,
  ): Promise<{ file: string; data: Buffer }> {
    this.requireEnroll(actor);
    const issued = await this._issue.archive(actor.userId, issueInput(request));

    this.auditIssue(actor.userId, "archive", issued.tokenId, request);

    return { file: issued.file, data: issued.data };
  }

  /** Одноразовая ссылка на архив агента с токеном. */
  async issueLink(
    actor: IAgentActor,
    request: IAgentIssueRequest & { linkExpiresInMinutes?: number },
  ): Promise<IAgentIssuedLinkDto> {
    this.requireEnroll(actor);
    const link = await this._issue.link(
      actor.userId,
      issueInput(request),
      request.linkExpiresInMinutes ?? AGENT_ISSUE_TTL_MINUTES,
    );

    this.auditIssue(actor.userId, "link", link.id, request);

    return { url: link.url, expiresAt: link.expiresAt.getTime() };
  }

  private auditIssue(
    actorId: string,
    kind: string,
    target: string,
    request: IAgentIssueRequest,
  ): void {
    this._bus.emit(
      new AgentActionAuditedEvent("agent.issue", actorId, target, null, {
        kind,
        name: request.name,
        labels: request.labels,
      }),
    );
  }

  private audit(
    actorId: string | null,
    action: string,
    agentId: string,
    details?: Record<string, unknown>,
  ): void {
    this._bus.emit(
      new AgentActionAuditedEvent(action, actorId, agentId, agentId, details),
    );
  }
}
