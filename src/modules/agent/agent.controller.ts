import { inject } from "inversify";
import {
  Body,
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
import {
  getContextUser,
  Injectable,
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { KoaRequest } from "../../types/koa";
import { AgentService } from "./agent.service";
import {
  AgentCommandDto,
  AgentConfigDto,
  AgentDto,
  IAgentEventDto,
  IAgentLogsDto,
  IAgentMetricsPointDto,
  TAgentId,
  TAgentWorkerName,
} from "./dto";
import {
  AgentCommandsQuerySchema,
  AgentCommandWaitQuerySchema,
  AgentEventsQuerySchema,
  AgentLogsQuerySchema,
  AgentMetricsQuerySchema,
  AgentUpdateBodySchema,
  PageQuerySchema,
} from "./validation";

interface IAgentUpdateBody {
  /** Версия; без неё — новая, которую агент нашёл в своём каталоге сборок. */
  version?: string;
}

/**
 * Агенты. Доступ — право модуля (`agent:*`, все агенты) или политика (например, агенты своих
 * узлов): security — только вход, доступ к агенту проверяет сервис. Действия — команды агенту:
 * ответ — поставленная команда, итог — `GET /agents/{id}/commands/{commandId}` и сокет.
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
   * Агенты: связь, узел, воркеры (состояние, пульс, манифест), последняя точка метрик,
   * проблемы.
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
   * События воркеров, новые первыми; `cursor` — `nextCursor` прошлой страницы.
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

  /** @summary Агент */
  @Security("jwt")
  @Get("{id}")
  getAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<AgentDto> {
    return this._agents.get(getContextUser(req), id);
  }

  /**
   * Отозвать: агент больше не войдёт, связь прекращается; воркеры на узле работают.
   * Только с правом `agent:manage`.
   * @summary Отозвать агента
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
   * Удалить агента и всё его (настройки, команды, историю); агент на узле останавливает воркеры
   * с уборкой и больше не выходит на связь. Только с правом `agent:manage`.
   * @summary Удалить агента
   */
  @Security("jwt")
  @SuccessResponse(204)
  @Delete("{id}")
  async deleteAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<void> {
    await this._agents.delete(getContextUser(req), id);
    this.setStatus(204);
  }

  /** @summary Сменить ключ агента */
  @Security("jwt")
  @Post("{id}/rotate-key")
  rotateAgentKey(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<AgentCommandDto> {
    return this._agents.rotateKey(getContextUser(req), id);
  }

  /**
   * Обновить агента из его каталога сборок; итог присылает новая версия.
   * @summary Обновить агента
   */
  @Security("jwt")
  @ValidateBody(AgentUpdateBodySchema)
  @Post("{id}/update")
  updateAgent(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Body() body: IAgentUpdateBody,
  ): Promise<AgentCommandDto> {
    return this._agents.update(getContextUser(req), id, body.version);
  }

  /**
   * Последние записи журнала агента (или воркера) с узла; агент должен быть на связи.
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
    return this._agents.logs(getContextUser(req), id, worker, lines);
  }

  /** @summary История метрик агента */
  @Security("jwt")
  @ValidateQuery(AgentMetricsQuerySchema)
  @Get("{id}/metrics")
  getAgentMetrics(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Query() since?: number,
    @Query() until?: number,
    @Query() limit?: number,
  ): Promise<IAgentMetricsPointDto[]> {
    return this._agents.metrics(getContextUser(req), id, {
      since,
      until,
      limit,
    });
  }

  /**
   * Ключи настроек воркеров агента и итоги применения; значения — с правом на настройки.
   * @summary Настройки воркеров
   */
  @Security("jwt")
  @Get("{id}/configs")
  getAgentConfigs(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
  ): Promise<AgentConfigDto[]> {
    return this._agents.configs(getContextUser(req), id);
  }

  /** @summary Команды агенту, новые первыми */
  @Security("jwt")
  @ValidateQuery(AgentCommandsQuerySchema)
  @Get("{id}/commands")
  getAgentCommands(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Query() limit?: number,
  ): Promise<AgentCommandDto[]> {
    return this._agents.commands(getContextUser(req), id, limit);
  }

  /**
   * Команда и её итог; `waitSeconds` — подождать итог.
   * @summary Команда агенту
   */
  @Security("jwt")
  @ValidateQuery(AgentCommandWaitQuerySchema)
  @Get("{id}/commands/{commandId}")
  getAgentCommand(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() commandId: string,
    @Query() waitSeconds?: number,
  ): Promise<AgentCommandDto> {
    return this._agents.command(
      getContextUser(req),
      id,
      commandId,
      waitSeconds,
    );
  }

  /** @summary Отменить идущую команду воркера */
  @Security("jwt")
  @Post("{id}/commands/{commandId}/cancel")
  cancelAgentCommand(
    @Request() req: KoaRequest,
    @Path() id: TAgentId,
    @Path() commandId: string,
  ): Promise<AgentCommandDto> {
    return this._agents.cancelCommand(getContextUser(req), id, commandId);
  }
}
