import { inject } from "inversify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
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

import type { IErrorResponseDto, IPaginatedDto } from "../../core";
import {
  getContextUser,
  Injectable,
  normalizePagination,
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import type {
  IAgentUpdateResultDto,
  IAgentWorkerActionResultDto,
} from "../agent";
import {
  IAssignWgNodeBody,
  IBindWgNodeAgentBody,
  ICreatedWgNodeDto,
  ICreateWgNodeBody,
  ICreateWgNodeInstallCommandBody,
  IUpdateWgNodeBody,
  IUpdateWgNodeWorkerBody,
  IWgNodeInstallCommandDto,
  IWgNodeLogsDto,
  WgNodeDto,
  WgNodeOptionDto,
} from "./dto";
import {
  AssignWgNodeSchema,
  BindWgNodeAgentSchema,
  CreateWgNodeInstallCommandSchema,
  CreateWgNodeSchema,
  UpdateWgNodeSchema,
  UpdateWgNodeWorkerSchema,
  WgNodeLogsQuerySchema,
} from "./validation";
import { WgNodeService } from "./wg-node.service";
import { EWgNodeStatus } from "./wg-node.types";
import { WgNodeAgentService } from "./wg-node-agent.service";

/**
 * Имя воркера агента ноды в пути.
 * @pattern ^[a-z][a-z0-9-]{0,31}$ Некорректное имя воркера
 */
type TWgNodeWorker = string;

@Injectable()
@Tags("WgNode")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/nodes")
export class WgNodeController extends Controller {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeAgentService) private readonly _agents: WgNodeAgentService,
  ) {
    super();
  }

  /**
   * Создать ноду (VPS с агентом). В ответе — команда установки агента с
   * одноразовым токеном регистрации (токен виден только здесь; новый —
   * `POST /{id}/install-command`). Создатель — автор запроса; владелец,
   * отличный от себя, — только с правом `wg:node:assign`.
   * @summary Создание ноды
   */
  @Security("jwt", ["permission:wg:node:create"])
  @ValidateBody(CreateWgNodeSchema)
  @SuccessResponse(201, "Created")
  @Post()
  async createWgNode(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgNodeBody,
  ): Promise<ICreatedWgNodeDto> {
    const actor = getContextUser(req);
    const node = await this._nodes.create(actor, body);

    return {
      node: WgNodeDto.fromEntity(node),
      install: await this._agents.installFor(actor.userId, node),
    };
  }

  /**
   * Ноды с фильтрами, новые первыми. С правом `wg:node:view:own` — только
   * свои (владелец или создатель).
   * @param mine Только свои ноды (владелец или создатель) при любой области прав
   * @summary Список нод
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get()
  listWgNodes(
    @Request() req: KoaRequest,
    @Query() query?: string,
    @Query() status?: EWgNodeStatus,
    @Query() mine?: boolean,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgNodeDto>> {
    return this._nodes.list(
      getContextUser(req),
      { query, status, mine },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список нод для выпадающих списков (в рамках прав).
   * @param mine Только свои ноды (владелец или создатель) при любой области прав
   * @summary Ноды (options)
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get("options")
  wgNodeOptions(
    @Request() req: KoaRequest,
    @Query() mine?: boolean,
  ): Promise<WgNodeOptionDto[]> {
    return this._nodes.options(getContextUser(req), mine);
  }

  /**
   * Нода по id; чужая без права на все ноды — 404.
   * @summary Нода
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get("{id}")
  getWgNode(@Request() req: KoaRequest, @Path() id: UUID): Promise<WgNodeDto> {
    return this._nodes.get(getContextUser(req), id);
  }

  /**
   * Изменить ноду: переданные поля заменяются.
   * @summary Изменение ноды
   */
  @Security("jwt", ["permission:wg:node:update:own"])
  @ValidateBody(UpdateWgNodeSchema)
  @Patch("{id}")
  updateWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IUpdateWgNodeBody,
  ): Promise<WgNodeDto> {
    return this._nodes.update(getContextUser(req), id, body);
  }

  /**
   * Удалить ноду; ключ агента отзывается. Нода с интерфейсами — 409.
   * @summary Удаление ноды
   */
  @Security("jwt", ["permission:wg:node:delete:own"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._nodes.delete(getContextUser(req), id);
  }

  /**
   * Назначить владельца ноды (она станет для него своей).
   * @summary Назначение владельца ноды
   */
  @Security("jwt", ["permission:wg:node:assign:own"])
  @ValidateBody(AssignWgNodeSchema)
  @Post("{id}/assign")
  assignWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IAssignWgNodeBody,
  ): Promise<WgNodeDto> {
    return this._nodes.assign(getContextUser(req), id, body);
  }

  /**
   * Снять владельца ноды.
   * @summary Снятие владельца ноды
   */
  @Security("jwt", ["permission:wg:node:assign:own"])
  @Post("{id}/revoke")
  revokeWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<WgNodeDto> {
    return this._nodes.revoke(getContextUser(req), id);
  }

  /**
   * Команда установки агента на VPS: одноразовый токен регистрации с меткой
   * ноды (агент привяжется к ней), экземпляр проекта (`--instance`), воркеры
   * wg и socks, пакеты и параметры ядра. Токен виден только в ответе.
   * @summary Команда установки агента
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(CreateWgNodeInstallCommandSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/install-command")
  createWgNodeInstallCommand(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: ICreateWgNodeInstallCommandBody,
  ): Promise<IWgNodeInstallCommandDto> {
    return this._agents.installCommand(getContextUser(req), id, body);
  }

  /**
   * Привязать к ноде уже зарегистрированного агента (например, общим
   * токеном окружения); прежний агент ноды отзывается.
   * @summary Привязка агента к ноде
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(BindWgNodeAgentSchema)
  @SuccessResponse(204, "No Content")
  @Post("{id}/agent")
  async bindWgNodeAgent(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IBindWgNodeAgentBody,
  ): Promise<void> {
    await this._agents.bind(getContextUser(req), id, body.agentId);
  }

  /**
   * Обновить агента ноды до версии выпуска; итог — после запуска новой
   * версии агента.
   * @summary Обновление агента ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @Post("{id}/agent/update")
  updateWgNodeAgent(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<IAgentUpdateResultDto> {
    return this._agents.updateAgent(getContextUser(req), id);
  }

  /**
   * Обновить воркер агента ноды (`wg`, `socks`) из выпуска. Занятый воркер —
   * `deferred: true`, итог — событием `agent:action`.
   * @summary Обновление воркера ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(UpdateWgNodeWorkerSchema)
  @Post("{id}/workers/{worker}/update")
  updateWgNodeWorker(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() worker: TWgNodeWorker,
    @Body() body: IUpdateWgNodeWorkerBody,
  ): Promise<IAgentWorkerActionResultDto> {
    return this._agents.updateWorker(
      getContextUser(req),
      id,
      worker,
      body.force ?? false,
    );
  }

  /**
   * Перезапустить воркер агента ноды. Созданное воркером на узле
   * (интерфейсы, туннели, пробросы) при этом не разбирается.
   * @summary Перезапуск воркера ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(UpdateWgNodeWorkerSchema)
  @Post("{id}/workers/{worker}/restart")
  restartWgNodeWorker(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Path() worker: TWgNodeWorker,
    @Body() body: IUpdateWgNodeWorkerBody,
  ): Promise<IAgentWorkerActionResultDto> {
    return this._agents.restartWorker(
      getContextUser(req),
      id,
      worker,
      body.force ?? false,
    );
  }

  /**
   * Последние строки журнала агента ноды или его воркера (`worker`) — с
   * узла.
   * @summary Журнал агента
   */
  @Security("jwt", ["permission:wg:node:logs:own"])
  @ValidateQuery(WgNodeLogsQuerySchema)
  @Get("{id}/logs")
  wgNodeLogs(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Query() lines?: number,
    @Query() worker?: TWgNodeWorker,
  ): Promise<IWgNodeLogsDto> {
    return this._agents.logs(getContextUser(req), id, { lines, worker });
  }
}
