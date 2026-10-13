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
   * Сборки проекта и кого из доступных агентов можно обновить: воркеры wg и
   * socks — до сборки из `release/` архивов `AGENT_BUNDLE_DIR`, агента — до
   * новой версии, которую он нашёл в своём каталоге сборок (`update.latest`;
   * новая версия у агентов — сокет `agent:release`).
   * @summary Сборки агента
   */
  @Security("jwt")
  @Get()
  getAgentRelease(@Request() req: KoaRequest): Promise<IAgentReleaseDto> {
    return this._agents.release(getContextUser(req));
  }

  /**
   * Команда установки агента на новый узел одной строкой:
   * `curl …/api/v1/agent-link/bundle/install.sh | sudo sh -s -- --server … --bundle … --token …` — установщик агента
   * ставит архив папки агента (`agent pack`): экземпляр, воркеры, пакеты и права —
   * из неё.
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
