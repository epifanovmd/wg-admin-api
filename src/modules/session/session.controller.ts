import { inject } from "inversify";
import {
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

import type { IErrorResponseDto, IPaginatedDto, UUID } from "../../core";
import { getContextUser, Injectable } from "../../core";
import { KoaRequest } from "../../types/koa";
import { SessionDto } from "./session.dto";
import { SessionService } from "./session.service";

@Injectable()
@Tags("Session")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/session")
export class SessionController extends Controller {
  constructor(@inject(SessionService) private _sessionService: SessionService) {
    super();
  }

  /**
   * Получить список активных сессий пользователя (последние активные — первыми).
   * @summary Список сессий
   * @param offset Смещение (по умолчанию 0)
   * @param limit Размер страницы (по умолчанию 20, максимум 100)
   */
  @Security("jwt")
  @Get()
  getSessions(
    @Request() req: KoaRequest,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<SessionDto>> {
    const user = getContextUser(req);

    return this._sessionService.getSessions(user.userId, offset, limit);
  }

  /**
   * Завершить конкретную сессию: её access-токен сразу перестаёт действовать.
   * @summary Завершение сессии
   * @response 403 - Чужая сессия (SESSION_FORBIDDEN)
   * @response 404 - Сессия не найдена (SESSION_NOT_FOUND)
   */
  @Security("jwt")
  @Delete("{id}")
  @SuccessResponse(204, "No Content")
  async terminateSession(
    @Request() req: KoaRequest,
    @Path() id: UUID,
  ): Promise<void> {
    const user = getContextUser(req);

    await this._sessionService.terminateSession(id, user.userId);
    this.setStatus(204);
  }

  /**
   * Завершить все сессии, кроме текущей.
   * @summary Завершение остальных сессий
   */
  @Security("jwt")
  @Post("terminate-others")
  @SuccessResponse(204, "No Content")
  async terminateOtherSessions(@Request() req: KoaRequest): Promise<void> {
    const user = getContextUser(req);

    await this._sessionService.terminateAllOther(user.userId, user.sessionId);
    this.setStatus(204);
  }
}
