import { inject } from "inversify";
import { Readable } from "stream";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Produces,
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
import type { IAgentIssuedEnvDto, IAgentIssuedLinkDto } from "../agent";
import {
  IAssignWgNodeBody,
  IBindWgNodeAgentBody,
  ICreatedWgNodeDto,
  ICreateWgNodeBody,
  ICreateWgNodeInstallCommandBody,
  IIssueWgNodeAgentBody,
  IIssueWgNodeAgentLinkBody,
  IUpdateWgNodeBody,
  IWgNodeInstallCommandDto,
  WgNodeDto,
  WgNodeOptionDto,
} from "./dto";
import {
  AssignWgNodeSchema,
  BindWgNodeAgentSchema,
  CreateWgNodeInstallCommandSchema,
  CreateWgNodeSchema,
  IssueWgNodeAgentLinkSchema,
  IssueWgNodeAgentSchema,
  UpdateWgNodeSchema,
} from "./validation";
import { WgNodeService } from "./wg-node.service";
import { EWgNodeStatus } from "./wg-node.types";
import { WgNodeAgentService } from "./wg-node-agent.service";

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
   * `.env` агента ноды: адрес, одноразовый токен с меткой ноды (агент привяжется к ней), имя
   * агента — для архива агента или образа (`--env-file`). Токен — только в этом ответе.
   * @summary Выдать .env агента ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(IssueWgNodeAgentSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/agent/issue/env")
  async issueWgNodeAgentEnv(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IIssueWgNodeAgentBody,
  ): Promise<IAgentIssuedEnvDto> {
    const issued = await this._agents.issueEnv(getContextUser(req), id, body);

    this.setStatus(201);

    return issued;
  }

  /**
   * Архив агента (все платформы) с `.env` агента ноды: распаковать и запустить — службой, на
   * месте или в Docker.
   * @summary Выдать архив агента ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(IssueWgNodeAgentSchema)
  @Produces("application/gzip")
  @Post("{id}/agent/issue/archive")
  async issueWgNodeAgentArchive(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IIssueWgNodeAgentBody,
  ): Promise<Readable> {
    const archive = await this._agents.issueArchive(
      getContextUser(req),
      id,
      body,
    );

    this.setHeader("Content-Type", "application/gzip");
    this.setHeader(
      "Content-Disposition",
      `attachment; filename="${archive.file}"`,
    );
    this.setHeader("Cache-Control", "no-store");

    return Readable.from(archive.data);
  }

  /**
   * Одноразовая ссылка на архив агента ноды: скачать можно один раз и до срока, токен с
   * меткой ноды создаётся при скачивании.
   * @summary Выдать ссылку на архив агента ноды
   */
  @Security("jwt", ["permission:wg:node:agent:own"])
  @ValidateBody(IssueWgNodeAgentLinkSchema)
  @SuccessResponse(201, "Created")
  @Post("{id}/agent/issue/link")
  async issueWgNodeAgentLink(
    @Request() req: KoaRequest,
    @Path() id: UUID,
    @Body() body: IIssueWgNodeAgentLinkBody,
  ): Promise<IAgentIssuedLinkDto> {
    const link = await this._agents.issueLink(getContextUser(req), id, body);

    this.setStatus(201);

    return link;
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
}
