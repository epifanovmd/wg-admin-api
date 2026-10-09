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
import { AgentEnrollmentService } from "./agent-enrollment.service";
import {
  AgentEnrollmentTokenDto,
  ICreateAgentEnrollmentTokenBody,
  ICreatedAgentEnrollmentTokenDto,
} from "./dto";
import {
  CreateAgentEnrollmentTokenSchema,
  PageQuerySchema,
} from "./validation";

@Injectable()
@Tags("Agent")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/agent-enrollment-tokens")
export class AgentEnrollmentController extends Controller {
  constructor(
    @inject(AgentEnrollmentService)
    private readonly _enrollment: AgentEnrollmentService,
  ) {
    super();
  }

  /**
   * Создать токен регистрации агентов. Полный токен (`token`) — только в
   * этом ответе: он кладётся в настройки агента (`enroll.token`) или в
   * команду установки. `maxUses` не задан — многоразовый (парк машин).
   * @summary Создание токена регистрации
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateBody(CreateAgentEnrollmentTokenSchema)
  @SuccessResponse(201, "Created")
  @Post()
  async createAgentEnrollmentToken(
    @Request() req: KoaRequest,
    @Body() body: ICreateAgentEnrollmentTokenBody,
  ): Promise<ICreatedAgentEnrollmentTokenDto> {
    const created = await this._enrollment.createToken(
      getContextUser(req).userId,
      body,
    );

    this.setStatus(201);

    return created;
  }

  /**
   * Токены регистрации, новые первыми; секреты не возвращаются.
   * @summary Список токенов регистрации
   */
  @Security("jwt", ["permission:agent:enroll"])
  @ValidateQuery(PageQuerySchema)
  @Get()
  getAgentEnrollmentTokens(
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<AgentEnrollmentTokenDto>> {
    return this._enrollment.listTokens(offset, limit);
  }

  /**
   * Отозвать токен: новые регистрации по нему невозможны, агенты остаются.
   * Повторный отзыв — 204.
   * @summary Отзыв токена регистрации
   */
  @Security("jwt", ["permission:agent:enroll"])
  @SuccessResponse(204, "No Content")
  @Post("{id}/revoke")
  async revokeAgentEnrollmentToken(@Path() id: UUID): Promise<void> {
    await this._enrollment.revokeToken(id);
    this.setStatus(204);
  }
}
