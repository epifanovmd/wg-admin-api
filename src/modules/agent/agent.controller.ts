import { inject } from "inversify";
import {
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

import type {
  ICursorPageDto,
  IErrorResponseDto,
  IPaginatedDto,
} from "../../core";
import { getContextUser, Injectable, ValidateQuery } from "../../core";
import { KoaRequest } from "../../types/koa";
import { withRetryAfter } from "./agent.errors";
import { AgentService } from "./agent.service";
import {
  AgentAlertDto,
  AgentDto,
  IAgentEventDto,
  IAgentLogsDto,
  IAgentUpdateResultDto,
  TAgentId,
  TAgentWorkerName,
} from "./dto";
import {
  AgentAlertsQuerySchema,
  AgentEventsQuerySchema,
  AgentLogsQuerySchema,
  PageQuerySchema,
} from "./validation";

/**
 * Агенты. Доступ — право модуля (`agent:*`, все агенты) или политика
 * (например, агенты своих нод с правами `wg:node:*`): security — только вход,
 * доступ к агенту проверяет сервис. Действия с агентом выполняет процесс,
 * у которого его соединение; в другом — 503 `AGENT_ELSEWHERE` с `Retry-After`.
 */
@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agents")
export class AgentController extends Controller {
  constructor(@inject(AgentService) private readonly _agents: AgentService) {
    super();
  }

  /**
   * Агенты в порядке регистрации: связь, узел, воркеры (состояние,
   * самочувствие, манифест, настройки), последняя точка метрик, проблемы.
   * Право `agent:view` — все агенты, иначе — доступные через политику.
   * @summary Список агентов
   */
  @Security("jwt")
  @ValidateQuery(PageQuerySchema)
  @Get()
  getAgents(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<AgentDto>> {
    return this._agents.list(getContextUser(req), offset, limit);
  }

  /**
   * Текущие проблемы: агент без связи, воркер упал, не зарегистрирован, не в
   * порядке, отказал в настройке. Без `agentId` — у всех доступных агентов.
   * @summary Проблемы агентов
   */
  @Security("jwt")
  @ValidateQuery(AgentAlertsQuerySchema)
  @Get("alerts")
  getAgentAlerts(
    @Request() req: KoaRequest,
    @Query() agentId?: string,
  ): Promise<AgentAlertDto[]> {
    return this._agents.alerts(getContextUser(req), agentId);
  }

  /**
   * События воркеров, новые первыми: фильтр по агенту, воркеру и типу;
   * следующая страница — `cursor` из ответа.
   * @summary Лента событий воркеров
   */
  @Security("jwt")
  @ValidateQuery(AgentEventsQuerySchema)
  @Get("events")
  getAgentEvents(
    @Request() req: KoaRequest,
    @Query() agentId?: string,
    @Query() worker?: string,
    @Query() type?: string,
    @Query() cursor?: string,
    @Query() limit?: number,
  ): Promise<ICursorPageDto<IAgentEventDto>> {
    return this._agents.events(getContextUser(req), {
      agentId,
      worker,
      type,
      cursor,
      limit,
    });
  }

  /**
   * Агент: `hello` (версия, узел, воркеры), последний `status` (воркеры с
   * `state`, `health`, `pending`, манифестом и итогами настроек), метрики,
   * проблемы, процесс с соединением.
   * @summary Агент
   */
  @Security("jwt")
  @Get("{id}")
  getAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<AgentDto> {
    return this._agents.get(getContextUser(req), id);
  }

  /**
   * Отозвать агента: ключ больше не принимается, соединение закрывается.
   * Повторный отзыв — тот же ответ.
   * @summary Отзыв агента
   */
  @Security("jwt")
  @Post("{id}/revoke")
  revokeAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<AgentDto> {
    return this._agents.revoke(getContextUser(req), id);
  }

  /**
   * Удалить запись агента, его настройки и историю; соединение закрывается.
   * Агент с токеном регистрации зарегистрируется заново — уже другим.
   * @summary Удаление агента
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<void> {
    await this._agents.delete(getContextUser(req), id);
    this.setStatus(204);
  }

  /**
   * Сменить ключ агента: агент создаёт новый секрет и переподключается с
   * ним. Агент должен быть на связи.
   * @summary Смена ключа агента
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Post("{id}/rotate-key")
  async rotateAgentKey(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<void> {
    await withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () => this._agents.rotateKey(getContextUser(req), id),
    );
    this.setStatus(204);
  }

  /**
   * Обновить агента до новой версии (`AGENT_RELEASES_DIR`): итог — после
   * запуска новой версии. Агент в контейнере себя не обновляет.
   * @summary Обновление агента
   */
  @Security("jwt")
  @Post("{id}/update")
  updateAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<IAgentUpdateResultDto> {
    return withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () => this._agents.update(getContextUser(req), id),
    );
  }

  /**
   * Последние строки журнала с узла: агента или воркера (`worker`).
   * @summary Журнал агента
   */
  @Security("jwt")
  @ValidateQuery(AgentLogsQuerySchema)
  @Get("{id}/logs")
  getAgentLogs(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Query() worker?: TAgentWorkerName,
    @Query() lines?: number,
  ): Promise<IAgentLogsDto> {
    return withRetryAfter(
      (name, value) => this.setHeader(name, value),
      () => this._agents.logs(getContextUser(req), id, { worker, lines }),
    );
  }
}
