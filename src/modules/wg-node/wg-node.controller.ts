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
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import {
  IAssignWgNodeBody,
  ICreatedWgNodeDto,
  ICreateWgNodeBody,
  IUpdateWgNodeBody,
  IWgAgentKeyDto,
  IWgNodeLogsDto,
  WgNodeDto,
  WgNodeOptionDto,
} from "./dto";
import {
  AssignWgNodeSchema,
  CreateWgNodeSchema,
  UpdateWgNodeSchema,
} from "./validation";
import { WgNodePermissions } from "./wg-node.permissions";
import { WgNodeService } from "./wg-node.service";
import { EWgNodeStatus, WG_AGENT_LOGS_MAX_LINES } from "./wg-node.types";
import { WgNodeCommandService } from "./wg-node-command.service";

@Injectable()
@Tags("WgNode")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/wg/nodes")
export class WgNodeController extends Controller {
  constructor(
    @inject(WgNodeService) private readonly _nodes: WgNodeService,
    @inject(WgNodeCommandService)
    private readonly _commands: WgNodeCommandService,
  ) {
    super();
  }

  /**
   * Создать ноду (VPS с агентом). Ключ агента возвращается только в этом
   * ответе — сохранить сразу. Создатель — автор запроса; владелец, отличный
   * от себя, — только с правом `wg:node:assign`.
   * @summary Создание ноды
   */
  @Security("jwt", ["permission:wg:node:create"])
  @ValidateBody(CreateWgNodeSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgNode(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgNodeBody,
  ): Promise<ICreatedWgNodeDto> {
    return this._nodes.create(getContextUser(req), body);
  }

  /**
   * Ноды с фильтрами, новые первыми. С правом `wg:node:view:own` — только
   * свои (владелец или создатель).
   * @summary Список нод
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get()
  listWgNodes(
    @Request() req: KoaRequest,
    @Query() query?: string,
    @Query() status?: EWgNodeStatus,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgNodeDto>> {
    return this._nodes.list(
      getContextUser(req),
      { query, status },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список нод для выпадающих списков (в рамках прав).
   * @summary Ноды (options)
   */
  @Security("jwt", ["permission:wg:node:view:own"])
  @Get("options")
  wgNodeOptions(@Request() req: KoaRequest): Promise<WgNodeOptionDto[]> {
    return this._nodes.options(getContextUser(req));
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
   * Перевыпустить ключ агента: старый отзывается сразу, новый возвращается
   * один раз.
   * @summary Ротация ключа агента
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @SuccessResponse(201, "Created")
  @Post("{id}/agent-key")
  rotateWgAgentKey(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<IWgAgentKeyDto> {
    return this._nodes.rotateAgentKey(getContextUser(req), id);
  }

  /**
   * Последние строки журнала агента ноды (синхронно, через команду агенту).
   * @summary Журнал агента
   */
  @Security("jwt", ["permission:wg:node:logs:own"])
  @Get("{id}/logs")
  async wgNodeLogs(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Query() lines?: number,
  ): Promise<IWgNodeLogsDto> {
    const actor = getContextUser(req);
    const capped =
      lines === undefined
        ? undefined
        : Math.max(1, Math.min(lines, WG_AGENT_LOGS_MAX_LINES));

    await this._nodes.findFor(actor, id, WgNodePermissions.NODE_LOGS);

    return this._commands.requestAgentLogs(id, actor.userId, capped);
  }
}
