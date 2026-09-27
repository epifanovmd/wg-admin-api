import { In, LessThan, Not } from "typeorm";

import { InjectableRepository } from "../../core";
import { BaseRepository } from "../../core/repository/repository";
import { JobRun } from "./job-run.entity";
import { EJobRunStatus, SETTLED_JOB_RUN_STATUSES } from "./jobs.types";

export interface IJobRunFilter {
  ownerId?: string;
  scope?: { type: string; id: string };
  statuses?: EJobRunStatus[];
  offset: number;
  limit: number;
}

/** Статусы, после которых запись не меняется воркером. */
const FINAL_STATUSES = [EJobRunStatus.COMPLETED, EJobRunStatus.CANCELLED];

@InjectableRepository(JobRun)
export class JobRunRepository extends BaseRepository<JobRun> {
  findById(id: string): Promise<JobRun | null> {
    return this.findOne({ where: { id } });
  }

  findPage({
    ownerId,
    scope,
    statuses,
    offset,
    limit,
  }: IJobRunFilter): Promise<[JobRun[], number]> {
    return this.findAndCount({
      where: {
        ...(ownerId !== undefined && { ownerId }),
        ...(scope !== undefined && {
          scopeType: scope.type,
          scopeId: scope.id,
        }),
        ...(statuses !== undefined &&
          statuses.length > 0 && { status: In(statuses) }),
      },
      order: { createdAt: "DESC" },
      skip: offset,
      take: limit,
    });
  }

  /** Взять задачу в работу, если она не завершена и не отменена. */
  async markRunning(
    id: string,
    patch: Pick<JobRun, "attempt" | "startedAt" | "leaseUntil">,
  ): Promise<boolean> {
    const { affected } = await this.update(
      { id, status: Not(In(FINAL_STATUSES)) },
      {
        ...patch,
        status: EJobRunStatus.RUNNING,
        finishedAt: null,
        error: null,
      },
    );

    return (affected ?? 0) > 0;
  }

  /** Продлить аренду выполняющейся задачи. */
  async extendLease(id: string, leaseUntil: Date): Promise<boolean> {
    const { affected } = await this.update(
      { id, status: EJobRunStatus.RUNNING },
      { leaseUntil },
    );

    return (affected ?? 0) > 0;
  }

  /** Удалить завершённые записи старше даты; вернуть сколько удалено. */
  async deleteSettledBefore(before: Date): Promise<number> {
    const { affected } = await this.delete({
      status: In(SETTLED_JOB_RUN_STATUSES as EJobRunStatus[]),
      finishedAt: LessThan(before),
    });

    return affected ?? 0;
  }

  /** Выполняющиеся задачи с истёкшей арендой: воркер пропал. */
  findExpiredLeases(now: Date, limit: number): Promise<JobRun[]> {
    return this.find({
      where: { status: EJobRunStatus.RUNNING, leaseUntil: LessThan(now) },
      order: { leaseUntil: "ASC" },
      take: limit,
    });
  }

  /** Из `ids` — те, которым запрошена отмена. */
  async findCancelRequestedIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];

    const rows = await this.find({
      select: { id: true },
      where: { id: In(ids), cancelRequested: true },
    });

    return rows.map(row => row.id);
  }
}
