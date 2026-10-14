import { inject } from "inversify";
import { Readable } from "stream";
import {
  Body,
  Controller,
  Get,
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
  ValidateBody,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { AgentService } from "./agent.service";
import type { AgentInstallMode } from "./agent.types";
import {
  AgentEnrollmentTokenDto,
  IAgentInstallCommandDto,
  IAgentInstallOptionsDto,
  IAgentIssuedEnvDto,
  IAgentIssuedLinkDto,
  IAgentReleaseDto,
  ICreatedAgentEnrollmentTokenDto,
} from "./dto";
import {
  CreateEnrollmentTokenSchema,
  InstallCommandBodySchema,
  IssueAgentBodySchema,
  IssueAgentLinkBodySchema,
  PageQuerySchema,
} from "./validation";

interface ICreateEnrollmentTokenBody {
  name: string;
  /** Метки зарегистрированных агентов (агент их не перепишет). */
  labels?: Record<string, string>;
  maxUses?: number;
  expiresAt?: Date;
}

interface IInstallCommandBody {
  /** Токен регистрации (или `tokenFile` — путь к файлу с ним на узле). */
  token?: string;
  tokenFile?: string;
  name?: string;
  /** Адрес API для узла; без него — `AGENT_PUBLIC_URL`. */
  baseUrl?: string;
  mode?: AgentInstallMode;
}

interface IIssueAgentBody {
  /** Имя агента (`AGENT_NAME` в `.env`); нет — имя машины. */
  name?: string;
  /** Метки зарегистрированного агента (агент их не перепишет). */
  labels?: Record<string, string>;
  /** Сколько машин может зарегистрироваться этим токеном (по умолчанию 1). */
  maxUses?: number;
  /** Срок токена, мин (по умолчанию сутки). */
  expiresInMinutes?: number;
  /** Адрес API для агента; без него — `AGENT_PUBLIC_URL`. */
  baseUrl?: string;
}

interface IIssueAgentLinkBody extends IIssueAgentBody {
  /** Срок ссылки, мин (по умолчанию сутки); токен создаётся при скачивании. */
  linkExpiresInMinutes?: number;
}

/** Регистрация агентов: токены, команда установки, каталог сборок воркеров. */
@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agent-enrollment")
export class AgentEnrollmentController extends Controller {
  constructor(@inject(AgentService) private readonly _agents: AgentService) {
    super();
  }

  /**
   * Создать токен регистрации; полный токен — только в этом ответе.
   * @summary Создать токен регистрации
   */
  @Security("jwt")
  @SuccessResponse(201)
  @ValidateBody(CreateEnrollmentTokenSchema)
  @Post("tokens")
  async createAgentEnrollmentToken(
    @Request() req: KoaRequest,
    @Body() body: ICreateEnrollmentTokenBody,
  ): Promise<ICreatedAgentEnrollmentTokenDto> {
    const created = await this._agents.createToken(getContextUser(req), body);

    this.setStatus(201);

    return created;
  }

  /** @summary Токены регистрации */
  @Security("jwt")
  @ValidateQuery(PageQuerySchema)
  @Get("tokens")
  getAgentEnrollmentTokens(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<AgentEnrollmentTokenDto>> {
    return this._agents.listTokens(getContextUser(req), offset, limit);
  }

  /** @summary Отозвать токен регистрации */
  @Security("jwt")
  @SuccessResponse(204)
  @Post("tokens/{id}/revoke")
  async revokeAgentEnrollmentToken(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    await this._agents.revokeToken(getContextUser(req), id);
    this.setStatus(204);
  }

  /**
   * Команда установки агента на узел из архива этого сервера.
   * @summary Команда установки агента
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(InstallCommandBodySchema)
  @Post("install-command")
  async createAgentInstallCommand(
    @Body() body: IInstallCommandBody,
  ): Promise<IAgentInstallCommandDto> {
    const { baseUrl, ...rest } = body;

    return {
      command: await this._agents.installCommand({ ...rest, server: baseUrl }),
    };
  }

  /**
   * Адрес бэкенда для агентов и архив агента: платформы, есть ли запуск в Docker Compose.
   * @summary Варианты установки агента
   */
  @Security("jwt", ["permission:agent:enroll"])
  @Get("install-options")
  getAgentInstallOptions(
    @Request() req: KoaRequest,
  ): Promise<IAgentInstallOptionsDto> {
    return this._agents.installOptions(getContextUser(req));
  }

  /**
   * Токен регистрации и `.env` с адресом, токеном и именем — для архива агента или образа
   * (`--env-file`). Токен — только в этом ответе.
   * @summary Выдать токен и .env агента
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(IssueAgentBodySchema)
  @SuccessResponse(201)
  @Post("issue/env")
  async issueAgentEnv(
    @Request() req: KoaRequest,
    @Body() body: IIssueAgentBody,
  ): Promise<IAgentIssuedEnvDto> {
    const issued = await this._agents.issueEnv(getContextUser(req), body);

    this.setStatus(201);

    return issued;
  }

  /**
   * Архив агента (все платформы) с `.env` (адрес, одноразовый токен, имя): распаковать и
   * запустить — службой, на месте или в Docker. Архив на сервере не хранится.
   * @summary Выдать архив агента с токеном
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(IssueAgentBodySchema)
  @Produces("application/gzip")
  @Post("issue/archive")
  async issueAgentArchive(
    @Request() req: KoaRequest,
    @Body() body: IIssueAgentBody,
  ): Promise<Readable> {
    const archive = await this._agents.issueArchive(getContextUser(req), body);

    this.setHeader("Content-Type", "application/gzip");
    this.setHeader(
      "Content-Disposition",
      `attachment; filename="${archive.file}"`,
    );
    this.setHeader("Cache-Control", "no-store");

    return Readable.from(archive.data);
  }

  /**
   * Одноразовая ссылка на архив агента с токеном (для передачи человеку): скачать можно один
   * раз и до срока, токен создаётся при скачивании.
   * @summary Выдать ссылку на архив агента
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(IssueAgentLinkBodySchema)
  @SuccessResponse(201)
  @Post("issue/link")
  async issueAgentLink(
    @Request() req: KoaRequest,
    @Body() body: IIssueAgentLinkBody,
  ): Promise<IAgentIssuedLinkDto> {
    const link = await this._agents.issueLink(getContextUser(req), body);

    this.setStatus(201);

    return link;
  }

  /**
   * Каталог сборок воркеров проекта (`AGENT_BUNDLE_DIR/release`).
   * @summary Сборки воркеров
   */
  @Security("jwt")
  @Get("release")
  getAgentRelease(@Request() req: KoaRequest): IAgentReleaseDto {
    return this._agents.release(getContextUser(req));
  }
}
