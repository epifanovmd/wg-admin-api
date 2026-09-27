import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { JobRun } from "./job-run.entity";
import { JobRunRepository } from "./job-run.repository";
import { JobSignals } from "./job-signals";
import {
  JOB_RESULT_POLL_MS,
  JOB_SETTLED_CHANNEL,
  SETTLED_JOB_RUN_STATUSES,
} from "./jobs.types";

/** С LISTEN запись перечитывается редко — только на случай потерянного сигнала. */
const SAFETY_POLL_MS = 5_000;

/**
 * Ожидание итога видимой задачи в любом процессе: сигнал `job_settled` будит
 * проверку записи, опрос страхует от потерянного сигнала и работы без LISTEN.
 */
@Injectable()
export class JobResultWaiter {
  constructor(
    @inject(JobSignals) private readonly _signals: JobSignals,
    @inject(JobRunRepository) private readonly _runs: JobRunRepository,
  ) {}

  /** Запись в итоговом статусе; `null` — не дождались за `timeoutMs`. */
  wait(id: string, timeoutMs: number): Promise<JobRun | null> {
    return new Promise(resolve => {
      let settled = false;
      let checking = false;

      const finish = (run: JobRun | null) => {
        if (settled) return;

        settled = true;
        unsubscribe();
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(run);
      };

      const check = async () => {
        if (settled || checking) return;

        checking = true;
        try {
          const run = await this._runs.findById(id);

          if (run && SETTLED_JOB_RUN_STATUSES.includes(run.status)) finish(run);
        } catch (err) {
          logger.warn({ err, jobId: id }, "[Jobs] Проверка итога задачи");
        } finally {
          checking = false;
        }
      };

      const unsubscribe = this._signals.on(JOB_SETTLED_CHANNEL, payload => {
        if (payload === id) void check();
      });
      const poll = setInterval(
        () => void check(),
        this._signals.isListening ? SAFETY_POLL_MS : JOB_RESULT_POLL_MS,
      );
      const deadline = setTimeout(() => finish(null), timeoutMs);

      poll.unref();
      void check();
    });
  }
}
