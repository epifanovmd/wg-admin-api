import { inject } from "inversify";
import {
  Body,
  Controller,
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
import {
  AgentEnrollmentTokenDto,
  IAgentInstallCommandDto,
  IAgentReleaseDto,
  ICreatedAgentEnrollmentTokenDto,
} from "./dto";
import {
  CreateEnrollmentTokenSchema,
  InstallCommandBodySchema,
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
  mode?: "systemd" | "rootless" | "run";
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
  createAgentInstallCommand(
    @Body() body: IInstallCommandBody,
  ): IAgentInstallCommandDto {
    const { baseUrl, ...rest } = body;

    return {
      command: this._agents.installCommand({ ...rest, server: baseUrl }),
    };
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
