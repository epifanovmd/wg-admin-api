import {
  type Agent,
  type AgentEvent,
  AgentsError,
  type LogEntry,
  type ReleaseView,
} from "agent-sdk/server";
import { inject } from "inversify";

import { config } from "../../config";
import {
  HttpException,
  ICursorPageDto,
  Injectable,
  IPaginatedDto,
  normalizePagination,
  toPage,
} from "../../core";
import { agentConfig } from "./agent.config";
import { AgentError, callAgents, toAgentError } from "./agent.errors";
import { AgentRuntime } from "./agent.runtime";
import {
  AgentAccessService,
  IAgentActor,
  inScope,
} from "./agent-access.service";
import { bundleInstallFlags, bundleInstallUrl } from "./agent-bundle";
import {
  AgentHistoryService,
  IAgentEventFeedQuery,
} from "./agent-history.service";
import {
  IAgentUpdateCandidate,
  IUpdateCandidates,
  selfUpdating,
  updateCandidates,
} from "./agent-update-candidates";
import {
  AgentAlertDto,
  AgentConfigStatusDto,
  AgentDto,
  IAgentEventDto,
  IAgentInstallCommandDto,
  IAgentLogsDto,
  IAgentReleaseDto,
  IAgentReleaseManifestDto,
  IAgentUpdateCandidateDto,
  IAgentUpdateResultDto,
  ICreateAgentInstallCommandBody,
} from "./dto";

/** Сколько событий на странице по умолчанию. */
const EVENTS_DEFAULT_LIMIT = 50;

/** Фильтр ленты событий. */
export interface IAgentEventsQuery {
  agentId?: string;
  worker?: string;
  type?: string;
  cursor?: string;
  limit?: number;
}

/** Параметры журнала. */
export interface IAgentLogsQuery {
  worker?: string;
  lines?: number;
}

/** Значение в одинарных кавычках POSIX sh. */
const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Кандидат обновления агента для API: имя агента — в `name`. */
const toCandidateDto = ({
  agentName,
  ...rest
}: IAgentUpdateCandidate): IAgentUpdateCandidateDto => ({
  ...rest,
  name: agentName,
  source: "agent",
});

/** Сборки проекта для API: все из каталога проекта (`source: local`). */
const toManifestDto = ({
  artifacts,
  workers,
  ...rest
}: ReleaseView): IAgentReleaseManifestDto => ({
  ...rest,
  artifacts: artifacts.map(artifact => ({ ...artifact, source: "local" })),
  ...(workers && {
    workers: workers.map(artifact => ({ ...artifact, source: "local" })),
  }),
});

/**
 * Агенты: список и карточка (`hello`, `status` с воркерами, последняя точка
 * метрик, проблемы), отзыв, удаление, смена ключа, обновление, журнал,
 * сборки проекта, кандидаты на обновление и команда установки. Доступ —
 * право модуля или политика (`AgentAccessService`); действия — от имени
 * пользователя: «кто что сделал» — в аудит (`AgentRuntime.act`, `audit`).
 */
@Injectable()
export class AgentService {
  constructor(
    @inject(AgentRuntime) private readonly _runtime: AgentRuntime,
    @inject(AgentAccessService) private readonly _access: AgentAccessService,
    @inject(AgentHistoryService) private readonly _history: AgentHistoryService,
  ) {}

  /** Агенты в порядке регистрации: все или доступные через политики. */
  async list(
    actor: IAgentActor,
    offset?: number,
    limit?: number,
  ): Promise<IPaginatedDto<AgentDto>> {
    const scope = await this._access.scope(actor, "view");
    const page = normalizePagination(offset, limit);
    const agents = (await this._runtime.agents.listAgents()).filter(agent =>
      inScope(scope, agent.id),
    );

    return toPage(
      await Promise.all(
        agents
          .slice(page.offset, page.offset + page.limit)
          .map(agent => this._runtime.toDto(agent)),
      ),
      agents.length,
      page,
    );
  }

  async get(actor: IAgentActor, id: string): Promise<AgentDto> {
    await this._access.require(actor, id, "view");

    return this._runtime.toDto(await this.require(id));
  }

  /** Текущие проблемы: одного агента или всех в области просмотра. */
  async alerts(actor: IAgentActor, agentId?: string): Promise<AgentAlertDto[]> {
    if (agentId) await this._access.require(actor, agentId, "view");

    const scope = agentId ? "all" : await this._access.scope(actor, "view");
    const agents = agentId
      ? [await this.require(agentId)]
      : (await this._runtime.agents.listAgents()).filter(agent =>
          inScope(scope, agent.id),
        );
    const alerts = await Promise.all(
      agents.map(agent => this._runtime.alertsOf(agent)),
    );

    return alerts.flat().map(AgentAlertDto.fromModel);
  }

  /** Лента событий воркеров, новые первыми: одного агента или всех в области. */
  async events(
    actor: IAgentActor,
    query: IAgentEventsQuery,
  ): Promise<ICursorPageDto<IAgentEventDto>> {
    if (query.agentId) await this._access.require(actor, query.agentId, "view");

    const scope = query.agentId
      ? new Set([query.agentId])
      : await this._access.scope(actor, "view");
    const feed: IAgentEventFeedQuery = {
      agentIds: scope === "all" ? undefined : [...scope],
      worker: query.worker,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit ?? EVENTS_DEFAULT_LIMIT,
    };

    return this._history.eventFeed(feed);
  }

  /**
   * Отозвать: ключ больше не принимается, соединение закрывается. Только с
   * правом модуля `agent:manage`: доступ через политику (свой узел) отзыв не
   * открывает — агента узла убирает удаление агента с узла.
   */
  async revoke(actor: IAgentActor, id: string): Promise<AgentDto> {
    await this.requireModuleManage(actor, id);

    return this._runtime.toDto(await this.revokeAgent(actor.userId, id));
  }

  /** Удалить запись агента, его настройки и историю (только `agent:manage`). */
  async delete(actor: IAgentActor, id: string): Promise<void> {
    await this.requireModuleManage(actor, id);
    await callAgents(() => this.deleteAgent(actor.userId, id));
  }

  /** Сменить ключ: агент переподключится с новым секретом. */
  async rotateKey(actor: IAgentActor, id: string): Promise<void> {
    await this._access.require(actor, id, "manage");
    await callAgents(() =>
      this._runtime.act(actor.userId, id, "agent.rotateKey", {}, () =>
        this._runtime.agents.rotateKey(id),
      ),
    );
  }

  /** Обновить агента до доступной версии; итог — после запуска новой версии. */
  async update(actor: IAgentActor, id: string): Promise<IAgentUpdateResultDto> {
    await this._access.require(actor, id, "manage");

    return this.updateAs(actor.userId, id);
  }

  /** Последние строки журнала агента или воркера (с узла). */
  async logs(
    actor: IAgentActor,
    id: string,
    query: IAgentLogsQuery,
  ): Promise<IAgentLogsDto> {
    await this._access.require(actor, id, "logs");

    const entries: LogEntry[] = await callAgents(() =>
      this._runtime.act(actor.userId, id, "agent.logs", { ...query }, () =>
        this._runtime.agents.logs(id, query),
      ),
    );

    return { entries };
  }

  /**
   * Сборки проекта (воркеры wg и socks — `release/` архивов
   * `AGENT_BUNDLE_DIR`) и кого можно обновить: агентов — до новой версии,
   * которую они нашли в своём каталоге сборок, воркеры — до сборки проекта.
   */
  async release(actor: IAgentActor): Promise<IAgentReleaseDto> {
    const scope = await this._access.scope(actor, "view");
    const { release, candidates } = await this.candidates();

    return {
      manifest: release && toManifestDto(release),
      candidates: candidates.agents
        .filter(c => inScope(scope, c.agentId))
        .map(toCandidateDto),
      workerCandidates: candidates.workers.filter(c =>
        inScope(scope, c.agentId),
      ),
    };
  }

  /**
   * Команда установки агента одной строкой: установщик агента с этого сервера
   * ставит архив папки агента (`agent pack`) под машину ноды —
   * `install.sh --bundle … --token …`.
   */
  installCommand(
    body: ICreateAgentInstallCommandBody,
  ): IAgentInstallCommandDto {
    const server = body.baseUrl ?? this.publicUrl();
    const flags = [
      ...bundleInstallFlags(server),
      ...(body.tokenFile
        ? ["--token-file", body.tokenFile]
        : ["--token", body.token ?? ""]),
      ...(body.name ? ["--name", body.name] : []),
    ];

    return {
      command: `curl -fsSL ${shQuote(bundleInstallUrl(server))} | sudo sh -s -- ${flags.map(shQuote).join(" ")}`,
    };
  }

  /** Адрес сервера для агентов: `AGENT_PUBLIC_URL` или `APP_PUBLIC_URL`. */
  publicUrl(): string {
    return (agentConfig.publicUrl ?? config.app.publicUrl).replace(/\/+$/, "");
  }

  // ─── для других модулей (без проверки прав) ──────────────────────────

  async find(id: string): Promise<AgentDto | null> {
    const agent = await this._runtime.agents.getAgent(id);

    return agent ? this._runtime.toDto(agent) : null;
  }

  async all(): Promise<AgentDto[]> {
    const agents = await this._runtime.agents.listAgents();

    return Promise.all(agents.map(agent => this._runtime.toDto(agent)));
  }

  /** Статус настроек агента (желаемая, доставленная, применённая версии). */
  async configStatus(id: string): Promise<AgentConfigStatusDto[]> {
    return (await this._runtime.agents.configStatus(id)).map(
      AgentConfigStatusDto.fromModel,
    );
  }

  /** Агенты, которых можно обновить до новой версии. */
  async updateCandidateIds(): Promise<Set<string>> {
    const { candidates } = await this.candidates();

    return new Set(candidates.agents.map(c => c.agentId));
  }

  /**
   * Обновить агента от имени пользователя (без проверки прав) до новой
   * версии, которую он нашёл в своём каталоге сборок: сборку агент берёт
   * оттуда сам. Агент себя не обновляет — `UPDATE_NOT_SUPPORTED`, новой
   * версии нет — `UPDATE_NOT_AVAILABLE`.
   */
  async updateAs(actorId: string, id: string): Promise<IAgentUpdateResultDto> {
    const agent = await this.require(id);

    if (agent.revoked) throw AgentError.REVOKED();
    if (!selfUpdating(agent)) throw AgentError.UPDATE_NOT_SUPPORTED();

    const candidate = updateCandidates([agent], null).agents[0];

    if (!candidate) throw AgentError.UPDATE_NOT_AVAILABLE();

    const version = candidate.target;

    return callAgents(() =>
      this._runtime.act(actorId, id, "agent.update", { version }, () =>
        this._runtime.agents.updateAgent(id, { version }),
      ),
    );
  }

  /** Журнал агента или воркера с узла (без проверки прав). */
  async logsOf(id: string, query: IAgentLogsQuery): Promise<LogEntry[]> {
    return callAgents(() => this._runtime.agents.logs(id, query));
  }

  /**
   * Версия агента в архивах для нод — сборок проекта (`agent pack
   * --release-out`); сборок нет — `null`.
   */
  async releaseVersion(): Promise<string | null> {
    const release = await this._runtime.agents.release();

    return release?.version ?? null;
  }

  /** Агенты на связи с этим процессом (наблюдение — здесь, без пересылки). */
  async localAgentIds(): Promise<string[]> {
    const agents = await this._runtime.agents.listAgents();

    return agents
      .filter(agent => this._runtime.isLocal(agent))
      .map(agent => agent.id);
  }

  /** Наблюдатель модуля: чаще метрики, пока он продлевается. */
  async watch(
    id: string,
    watch: { id: string; metricsIntervalMs: number; ttlMs: number },
  ): Promise<void> {
    await callAgents(() => this._runtime.agents.watch(id, watch));
  }

  async unwatch(id: string, watchId: string): Promise<void> {
    await callAgents(() => this._runtime.agents.unwatch(id, watchId));
  }

  /** Обработчик событий воркеров модуля — до подтверждения агенту. */
  onWorkerEvent(handler: (event: AgentEvent) => Promise<void>): () => void {
    return this._runtime.onWorkerEvent(handler);
  }

  /** Процесс держит соединения агентов (роли с HTTP). */
  get hasConnections(): boolean {
    return this._runtime.hasConnections;
  }

  /** Отозвать от имени пользователя (`actorId`) или системы (пусто). */
  async revokeAs(actorId: string, id: string): Promise<void> {
    await this.revokeAgent(actorId, id);
  }

  /** Отозвать и удалить запись (агент удалён с машины). */
  async revokeAndDelete(actorId: string, id: string): Promise<void> {
    try {
      await this.revokeAgent(actorId, id);
      await this.deleteAgent(actorId, id);
    } catch (err) {
      if (err instanceof AgentsError && err.code === "AGENT_NOT_FOUND") return;
      if (
        err instanceof HttpException &&
        err.code === AgentError.codes.NOT_FOUND
      ) {
        return;
      }
      throw toAgentError(err);
    }
  }

  /** Сборки проекта и кандидаты на обновление. */
  private async candidates(): Promise<{
    release: ReleaseView | null;
    candidates: IUpdateCandidates;
  }> {
    const agents = this._runtime.agents;
    const [list, release] = await Promise.all([
      agents.listAgents(),
      agents.release(),
    ]);

    return { release, candidates: updateCandidates(list, release) };
  }

  private async revokeAgent(actorId: string, id: string): Promise<Agent> {
    const agent = await callAgents(() => this._runtime.agents.revoke(id));

    this._runtime.audit("agent.revoke", actorId, id);

    return agent;
  }

  /** Удалить запись агента (ошибки SDK — как есть). */
  private async deleteAgent(actorId: string, id: string): Promise<void> {
    await this._runtime.agents.deleteAgent(id);
    this._runtime.deleted(actorId, id);
  }

  /** Видимый агент без права модуля на управление — 403, невидимый — 404. */
  private async requireModuleManage(
    actor: IAgentActor,
    id: string,
  ): Promise<void> {
    await this._access.require(actor, id, "view");
    if (!this._access.hasAll(actor, "manage")) throw AgentError.FORBIDDEN();
  }

  private async require(id: string): Promise<Agent> {
    const agent = await this._runtime.agents.getAgent(id);

    if (!agent) throw AgentError.NOT_FOUND();

    return agent;
  }
}
