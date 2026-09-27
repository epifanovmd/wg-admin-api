import { BaseDto } from "../../../core/dto/BaseDto";
import { JobRun } from "../job-run.entity";
import { EJobRunStatus, IJobRunError } from "../jobs.types";

export class JobRunDto extends BaseDto {
  /** Id задачи (совпадает с id pg-boss). */
  id: string;
  queue: string;
  status: EJobRunStatus;
  title: string;
  /** Прогресс 0..1. */
  progress: number;
  progressText: string | null;
  /** Последние строки лога. */
  logTail: string[];
  result: unknown;
  error: IJobRunError | null;
  ownerId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  /** Номер попытки, с 0. */
  attempt: number;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;

  constructor(entity: JobRun) {
    super(entity);

    this.id = entity.id;
    this.queue = entity.queue;
    this.status = entity.status;
    this.title = entity.title;
    this.progress = entity.progress;
    this.progressText = entity.progressText;
    this.logTail = entity.logTail;
    this.result = entity.result ?? null;
    this.error = entity.error;
    this.ownerId = entity.ownerId;
    this.scopeType = entity.scopeType;
    this.scopeId = entity.scopeId;
    this.attempt = entity.attempt;
    this.cancelRequested = entity.cancelRequested;
    this.startedAt = entity.startedAt;
    this.finishedAt = entity.finishedAt;
    this.createdAt = entity.createdAt;
  }

  static fromEntity(entity: JobRun): JobRunDto {
    return new JobRunDto(entity);
  }
}
