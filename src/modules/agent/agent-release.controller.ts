import { inject } from "inversify";
import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from "tsoa";

import type { IErrorResponseDto } from "../../core";
import { getContextUser, Injectable, ValidateBody } from "../../core";
import { KoaRequest } from "../../types/koa";
import { AgentService } from "./agent.service";
import {
  IAgentInstallCommandDto,
  IAgentReleaseDto,
  ICreateAgentInstallCommandBody,
} from "./dto";
import { CreateAgentInstallCommandSchema } from "./validation";

@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agent-releases")
export class AgentReleaseController extends Controller {
  constructor(@inject(AgentService) private readonly _agents: AgentService) {
    super();
  }

  /**
   * Выпуск агента и кого из доступных агентов можно обновить до него:
   * агент и netprobe — из выпусков GitHub (`AGENT_RELEASES_GITHUB`) или
   * базы выпуска (`AGENT_RELEASES_URL`), воркеры проекта wg и socks — из
   * `AGENT_RELEASES_DIR`. Новую версию агента в источнике бэкенд замечает
   * сам (сокет `agent:release`).
   * @summary Выпуск агента
   */
  @Security("jwt")
  @Get()
  getAgentRelease(@Request() req: KoaRequest): Promise<IAgentReleaseDto> {
    return this._agents.release(getContextUser(req));
  }

  /**
   * Команда установки агента на новый узел одной строкой:
   * `curl …/api/v1/agent-link/install.sh | sudo sh -s -- --token … [флаги]`
   * (воркеры из выпуска — `workers`, флаг `--worker`).
   * @summary Команда установки агента
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(CreateAgentInstallCommandSchema)
  @Post("install-command")
  createAgentInstallCommand(
    @Body() body: ICreateAgentInstallCommandBody,
  ): IAgentInstallCommandDto {
    return this._agents.installCommand(body);
  }
}
