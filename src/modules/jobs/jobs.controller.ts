import { inject } from "inversify";
import {
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
  isSuperUser,
  ValidateQuery,
} from "../../core";
import { UUID } from "../../core/http";
import { KoaRequest } from "../../types/koa";
import { JobRunDto } from "./dto/job-run.dto";
import { IJobViewer, JobsService } from "./jobs.service";
import { EJobRunStatus } from "./jobs.types";
import { ListJobsQuerySchema } from "./validation";

const viewerOf = (req: KoaRequest): IJobViewer => {
  const user = getContextUser(req);

  return { userId: user.userId, isSuperUser: isSuperUser(user) };
};

@Injectable()
@Tags("Jobs")
@Response<IErrorResponseDto>("default", "Ошибка")
@Route("api/v1/jobs")
export class JobsController extends Controller {
  constructor(@inject(JobsService) private readonly _jobs: JobsService) {
    super();
  }

  /**
   * Видимые задачи: свои, либо задачи scope (`scopeType` + `scopeId`), если
   * политика scope разрешает просмотр. Новые — первыми.
   * @summary Список задач
   */
  @Security("jwt")
  @ValidateQuery(ListJobsQuerySchema)
  @Get()
  listJobs(
    @Request() req: KoaRequest,
    @Query() status?: EJobRunStatus,
    @Query() scopeType?: string,
    @Query() scopeId?: string,
    @Query() offset?: number,
    @Query() limit?: number,
  ): Promise<IPaginatedDto<JobRunDto>> {
    return this._jobs.list(viewerOf(req), {
      status,
      scopeType,
      scopeId,
      offset,
      limit,
    });
  }

  /**
   * Задача: статус, прогресс, хвост лога, результат или ошибка.
   * @summary Задача
   */
  @Security("jwt")
  @Get("{id}")
  getJob(@Request() req: KoaRequest, @Path() id: UUID): Promise<JobRunDto> {
    return this._jobs.get(viewerOf(req), id);
  }

  /**
   * Отменить задачу: ждущая снимается сразу, выполняющаяся получает сигнал
   * отмены. Завершённую отменить нельзя (409).
   * @summary Отмена задачи
   */
  @Security("jwt")
  @SuccessResponse(204, "No Content")
  @Post("{id}/cancel")
  async cancelJob(@Request() req: KoaRequest, @Path() id: UUID): Promise<void> {
    await this._jobs.cancel(viewerOf(req), id);
    this.setStatus(204);
  }
}
