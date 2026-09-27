import type { JobRunDto } from "../dto/job-run.dto";

/** Видимая задача изменилась: статус, прогресс, лог. */
export class JobUpdatedEvent {
  constructor(public readonly job: JobRunDto) {}
}
