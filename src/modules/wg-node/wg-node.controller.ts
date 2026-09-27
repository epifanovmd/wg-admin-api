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
  ICreatedWgNodeDto,
  ICreateWgNodeBody,
  IUpdateWgNodeBody,
  IWgAgentKeyDto,
  IWgNodeLogsDto,
  WgNodeDto,
  WgNodeOptionDto,
} from "./dto";
import { CreateWgNodeSchema, UpdateWgNodeSchema } from "./validation";
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
   * ответе — сохранить сразу.
   * @summary Создание ноды
   */
  @Security("jwt", ["permission:wg:node:manage"])
  @ValidateBody(CreateWgNodeSchema)
  @SuccessResponse(201, "Created")
  @Post()
  createWgNode(
    @Request() req: KoaRequest,
    @Body() body: ICreateWgNodeBody,
  ): Promise<ICreatedWgNodeDto> {
    return this._nodes.create(getContextUser(req).userId, body);
  }

  /**
   * Ноды с фильтрами, новые первыми.
   * @summary Список нод
   */
  @Security("jwt", ["permission:wg:node:view"])
  @Get()
  listWgNodes(
    @Query() query?: string,
    @Query() status?: EWgNodeStatus,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<WgNodeDto>> {
    return this._nodes.list(
      { query, status },
      normalizePagination(offset, limit),
    );
  }

  /**
   * Краткий список нод для выпадающих списков.
   * @summary Ноды (options)
   */
  @Security("jwt", ["permission:wg:node:view"])
  @Get("options")
  wgNodeOptions(): Promise<WgNodeOptionDto[]> {
    return this._nodes.options();
  }

  /**
   * Нода по id.
   * @summary Нода
   */
  @Security("jwt", ["permission:wg:node:view"])
  @Get("{id}")
  getWgNode(@Path() id: UUID): Promise<WgNodeDto> {
    return this._nodes.get(id);
  }

  /**
   * Изменить ноду: переданные поля заменяются.
   * @summary Изменение ноды
   */
  @Security("jwt", ["permission:wg:node:manage"])
  @ValidateBody(UpdateWgNodeSchema)
  @Patch("{id}")
  updateWgNode(
    @Path() id: UUID,
    @Body() body: IUpdateWgNodeBody,
  ): Promise<WgNodeDto> {
    return this._nodes.update(id, body);
  }

  /**
   * Удалить ноду; ключ агента отзывается. Нода с интерфейсами — 409.
   * @summary Удаление ноды
   */
  @Security("jwt", ["permission:wg:node:manage"])
  @SuccessResponse(204, "No Content")
  @Delete("{id}")
  async deleteWgNode(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._nodes.delete(getContextUser(req).userId, id);
  }

  /**
   * Перевыпустить ключ агента: старый отзывается сразу, новый возвращается
   * один раз.
   * @summary Ротация ключа агента
   */
  @Security("jwt", ["permission:wg:node:manage"])
  @SuccessResponse(201, "Created")
  @Post("{id}/agent-key")
  rotateWgAgentKey(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<IWgAgentKeyDto> {
    return this._nodes.rotateAgentKey(getContextUser(req).userId, id);
  }

  /**
   * Последние строки журнала агента ноды (синхронно, через команду агенту).
   * @summary Журнал агента
   */
  @Security("jwt", ["permission:wg:node:manage"])
  @Get("{id}/logs")
  wgNodeLogs(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Query() lines?: number,
  ): Promise<IWgNodeLogsDto> {
    const capped =
      lines === undefined
        ? undefined
        : Math.max(1, Math.min(lines, WG_AGENT_LOGS_MAX_LINES));

    return this._commands.requestAgentLogs(
      id,
      getContextUser(req).userId,
      capped,
    );
  }
}
