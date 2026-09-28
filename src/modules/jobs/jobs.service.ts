import { inject, multiInject, optional } from "inversify";

import {
  IJobAccessPolicy,
  Injectable,
  IPaginatedDto,
  JOB_ACCESS_POLICY,
  JobAccessAction,
  JobQueue,
  normalizePagination,
  toPage,
} from "../../core";
import { JobRunDto } from "./dto/job-run.dto";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobsError } from "./jobs.errors";
import { ACTIVE_JOB_RUN_STATUSES, EJobRunStatus } from "./jobs.types";

/** Кто смотрит задачи. */
export interface IJobViewer {
  userId: string;
  /** Суперпользователь видит и отменяет любые задачи. */
  isSuperUser: boolean;
}

export interface IJobListQuery {
  status?: EJobRunStatus;
  scopeType?: string;
  scopeId?: string;
  offset?: number;
  limit?: number;
}

/**
 * Видимые задачи для пользователей: список, карточка, отмена. Доступ —
 * владелец, суперпользователь или политика scope (`IJobAccessPolicy`).
 */
@Injectable()
export class JobsService {
  constructor(
    @inject(JobRunRepository) private readonly _runs: JobRunRepository,
    @inject(JobQueue) private readonly _queue: JobQueue,
    @multiInject(JOB_ACCESS_POLICY)
    @optional()
    private readonly _policies: IJobAccessPolicy[] = [],
  ) {}

  /** Свои задачи или задачи scope. */
  async list(
    viewer: IJobViewer,
    query: IJobListQuery,
  ): Promise<IPaginatedDto<JobRunDto>> {
    const page = normalizePagination(query.offset, query.limit);
    const scope =
      query.scopeType && query.scopeId
        ? { type: query.scopeType, id: query.scopeId }
        : undefined;

    if (
      scope &&
      !viewer.isSuperUser &&
      !(await this.scopeAllows(viewer.userId, scope.type, scope.id, "view"))
    ) {
      throw JobsError.FORBIDDEN();
    }

    const [runs, total] = await this._runs.findPage({
      ...(scope ? { scope } : { ownerId: viewer.userId }),
      statuses: query.status ? [query.status] : undefined,
      ...page,
    });

    return toPage(runs.map(JobRunDto.fromEntity), total, page);
  }

  async get(viewer: IJobViewer, id: string): Promise<JobRunDto> {
    const run = await this.findAccessible(viewer, id, "view");

    return JobRunDto.fromEntity(run);
  }

  /**
   * Поставить демо-задачу внешнему воркеру: проверка, что воркеры подключены
   * и забирают задачи (эксплуатация, e2e). Задача видимая — статус в `/jobs/{id}`.
   */
  async cancel(viewer: IJobViewer, id: string): Promise<void> {
    const run = await this.findAccessible(viewer, id, "cancel");

    if (!ACTIVE_JOB_RUN_STATUSES.includes(run.status)) {
      throw JobsError.NOT_CANCELLABLE();
    }

    await this._queue.cancel(id);
  }

  /** Может ли пользователь видеть задачу (подписка на комнату сокета). */
  async canView(
    userId: string,
    id: string,
    isSuperUser = false,
  ): Promise<boolean> {
    const run = await this._runs.findById(id);

    if (!run) return false;

    return this.canAccess({ userId, isSuperUser }, run, "view");
  }

  private async findAccessible(
    viewer: IJobViewer,
    id: string,
    action: JobAccessAction,
  ): Promise<JobRun> {
    const run = await this._runs.findById(id);

    if (!run) throw JobsError.NOT_FOUND();
    if (!(await this.canAccess(viewer, run, action))) {
      throw JobsError.FORBIDDEN();
    }

    return run;
  }

  private async canAccess(
    viewer: IJobViewer,
    run: JobRun,
    action: JobAccessAction,
  ): Promise<boolean> {
    if (viewer.isSuperUser || run.ownerId === viewer.userId) return true;
    if (!run.scopeType || !run.scopeId) return false;

    return this.scopeAllows(viewer.userId, run.scopeType, run.scopeId, action);
  }

  private async scopeAllows(
    userId: string,
    scopeType: string,
    scopeId: string,
    action: JobAccessAction,
  ): Promise<boolean> {
    for (const policy of this._policies) {
      if (
        policy.scopeType === scopeType &&
        (await policy.canAccess(userId, scopeId, action))
      ) {
        return true;
      }
    }

    return false;
  }
}
