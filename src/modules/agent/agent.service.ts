import {
  type Agent,
  type AgentEvent,
  AgentsError,
  type LogEntry,
} from "agent-sdk/server";
import { inject } from "inversify";

import { config } from "../../config";
import {
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
import { installCommand } from "./agent-bundle";
import {
  AgentHistoryService,
  IAgentEventFeedQuery,
} from "./agent-history.service";
import { mergeUpdateCandidates } from "./agent-update";
import {
  AgentAlertDto,
  AgentConfigStatusDto,
  AgentDto,
  IAgentEventDto,
  IAgentInstallCommandDto,
  IAgentLogsDto,
  IAgentReleaseDto,
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

/**
 * Агенты: список и карточка (`hello`, `status` с воркерами, последняя точка
 * метрик, проблемы), отзыв, удаление, смена ключа, обновление, журнал,
 * сборки агента и команда установки. Доступ — право модуля или политика
 * (`AgentAccessService`); вызовы SDK — от имени пользователя (`by`), чтобы
 * действие попало в аудит.
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
      agents
        .slice(page.offset, page.offset + page.limit)
        .map(AgentDto.fromModel),
      agents.length,
      page,
    );
  }

  async get(actor: IAgentActor, id: string): Promise<AgentDto> {
    await this._access.require(actor, id, "view");

    return AgentDto.fromModel(await this.require(id));
  }

  /** Текущие проблемы: одного агента или всех в области просмотра. */
  async alerts(actor: IAgentActor, agentId?: string): Promise<AgentAlertDto[]> {
    if (agentId) await this._access.require(actor, agentId, "view");

    const scope = agentId ? "all" : await this._access.scope(actor, "view");
    const alerts = await this._runtime.agents.listAlerts(agentId);

    return alerts
      .filter(alert => inScope(scope, alert.agentId))
      .map(AgentAlertDto.fromModel);
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

    return AgentDto.fromModel(
      await callAgents(() => this._runtime.agents.by(actor.userId).revoke(id)),
    );
  }

  /** Удалить запись агента, его настройки и историю (только `agent:manage`). */
  async delete(actor: IAgentActor, id: string): Promise<void> {
    await this.requireModuleManage(actor, id);
    await callAgents(() =>
      this._runtime.agents.by(actor.userId).deleteAgent(id),
    );
  }

  /** Сменить ключ: агент переподключится с новым секретом. */
  async rotateKey(actor: IAgentActor, id: string): Promise<void> {
    await this._access.require(actor, id, "manage");
    await callAgents(() => this._runtime.agents.by(actor.userId).rotateKey(id));
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
      this._runtime.agents.by(actor.userId).logs(id, query),
    );

    return { entries };
  }

  /**
   * Итоговый манифест сборок (агент и netprobe — из удалённого источника, воркеры
   * wg и socks — из `release/` архивов `AGENT_BUNDLE_DIR`) и кого можно обновить.
   */
  async release(actor: IAgentActor): Promise<IAgentReleaseDto> {
    const scope = await this._access.scope(actor, "view");
    const agents = this._runtime.agents;
    const [manifest, candidates, workerCandidates, all] = await Promise.all([
      agents.release(),
      agents.updateCandidates(),
      agents.workerUpdateCandidates(),
      agents.listAgents(),
    ]);

    return {
      manifest,
      candidates: mergeUpdateCandidates(candidates, all).filter(c =>
        inScope(scope, c.agentId),
      ),
      workerCandidates: workerCandidates.filter(c => inScope(scope, c.agentId)),
    };
  }

  /**
   * Команда установки агента одной строкой: скрипт с этого сервера ставит архив
   * папки агента (`agent pack`) под машину ноды — `agent install --token …`.
   */
  installCommand(
    body: ICreateAgentInstallCommandBody,
  ): IAgentInstallCommandDto {
    return {
      command: installCommand(body.baseUrl ?? this.publicUrl(), body),
    };
  }

  /** Адрес сервера для агентов: `AGENT_PUBLIC_URL` или `APP_PUBLIC_URL`. */
  publicUrl(): string {
    return (agentConfig.publicUrl ?? config.app.publicUrl).replace(/\/+$/, "");
  }

  // ─── для других модулей (без проверки прав) ──────────────────────────

  async find(id: string): Promise<AgentDto | null> {
    const agent = await this._runtime.agents.getAgent(id);

    return agent ? AgentDto.fromModel(agent) : null;
  }

  async all(): Promise<AgentDto[]> {
    return (await this._runtime.agents.listAgents()).map(AgentDto.fromModel);
  }

  /** Статус настроек агента (желаемая, доставленная, применённая версии). */
  async configStatus(id: string): Promise<AgentConfigStatusDto[]> {
    return (await this._runtime.agents.configStatus(id)).map(
      AgentConfigStatusDto.fromModel,
    );
  }

  /** Агенты, которых можно обновить до новой версии. */
  async updateCandidateIds(): Promise<Set<string>> {
    const agents = this._runtime.agents;
    const [candidates, all] = await Promise.all([
      agents.updateCandidates(),
      agents.listAgents(),
    ]);

    return new Set(mergeUpdateCandidates(candidates, all).map(c => c.agentId));
  }

  /**
   * Обновить агента до новой версии от имени пользователя (без проверки прав): до версии с
   * сервера или до найденной самим агентом — её он берёт из своего каталога сборок.
   */
  async updateAs(actorId: string, id: string): Promise<IAgentUpdateResultDto> {
    const agents = this._runtime.agents;
    const [candidate] = mergeUpdateCandidates(
      (await agents.updateCandidates()).filter(c => c.agentId === id),
      [await agents.getAgent(id)].filter(a => !!a),
    );

    return callAgents(() =>
      candidate?.source === "agent"
        ? agents.by(actorId).updateAgent(id, { version: candidate.target })
        : agents.by(actorId).updateAgent(id),
    );
  }

  /** Журнал агента или воркера с узла (без проверки прав). */
  async logsOf(id: string, query: IAgentLogsQuery): Promise<LogEntry[]> {
    return callAgents(() => this._runtime.agents.logs(id, query));
  }

  /** Версия агента в сборках; сборок агента нет — `null`. */
  async releaseVersion(): Promise<string | null> {
    const release = await this._runtime.agents.release();

    return release?.artifacts.length ? release.version : null;
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
    const agents = this._runtime.agents;

    await callAgents(() => (actorId ? agents.by(actorId) : agents).revoke(id));
  }

  /** Отозвать и удалить запись (агент удалён с машины). */
  async revokeAndDelete(actorId: string, id: string): Promise<void> {
    const agents = this._runtime.agents;
    const as = actorId ? agents.by(actorId) : agents;

    try {
      await as.revoke(id);
      await as.deleteAgent(id);
    } catch (err) {
      if (err instanceof AgentsError && err.code === "AGENT_NOT_FOUND") return;
      throw toAgentError(err);
    }
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
