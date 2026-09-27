import { inject } from "inversify";
import {
  Controller,
  Get,
  Query,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from "tsoa";

import type { ICursorPageDto, IErrorResponseDto, UUID } from "../../core";
import { getContextUser, Injectable, ValidateQuery } from "../../core";
import { KoaRequest } from "../../types/koa";
import { AuditEventDto } from "./audit.dto";
import { AuditService } from "./audit.service";
import { AuditQuerySchema, MyAuditQuerySchema } from "./validation";

@Injectable()
@Tags("Audit")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/audit")
export class AuditController extends Controller {
  constructor(@inject(AuditService) private _auditService: AuditService) {
    super();
  }

  /**
   * Журнал безопасности текущего пользователя: входы (в том числе
   * неудачные), блокировки, 2FA, смена пароля, сессии, passkeys, биометрия.
   * Новые — первыми.
   * @summary Мой журнал безопасности
   * @param cursor Курсор следующей страницы (`nextCursor` предыдущего ответа)
   * @param limit Размер страницы (по умолчанию 20, максимум 100)
   * @param type Фильтр по типу события
   */
  @Security("jwt")
  @Get("my")
  @ValidateQuery(MyAuditQuerySchema)
  getMyAudit(
    @Request() req: KoaRequest,
    @Query() cursor?: string,
    @Query() limit?: number,
    @Query() type?: string,
  ): Promise<ICursorPageDto<AuditEventDto>> {
    const { userId } = getContextUser(req);

    return this._auditService.list({ actorId: userId, type }, cursor, limit);
  }

  /**
   * Журнал безопасности всех пользователей. Требует право `audit:view`.
   * @summary Журнал безопасности
   * @param cursor Курсор следующей страницы
   * @param limit Размер страницы (по умолчанию 20, максимум 100)
   * @param type Фильтр по типу события
   * @param actorId Фильтр по пользователю
   */
  @Security("jwt", ["permission:audit:view"])
  @Get()
  @ValidateQuery(AuditQuerySchema)
  listAuditEvents(
    @Query() cursor?: string,
    @Query() limit?: number,
    @Query() type?: string,
    @Query() actorId?: UUID,
  ): Promise<ICursorPageDto<AuditEventDto>> {
    return this._auditService.list({ actorId, type }, cursor, limit);
  }
}
