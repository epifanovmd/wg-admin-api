import { inject } from "inversify";
import { DataSource } from "typeorm";

import { Injectable, PgSignals } from "../../core";
import { JOB_SIGNAL_CHANNELS, TJobSignalChannel } from "./jobs.types";

/**
 * Сигналы задач между процессами (LISTEN/NOTIFY): отмена и завершение.
 * Механизм — `PgSignals` ядра.
 */
@Injectable()
export class JobSignals extends PgSignals<TJobSignalChannel> {
  constructor(@inject(DataSource) dataSource: DataSource) {
    super(dataSource, JOB_SIGNAL_CHANNELS, "job-signals");
  }
}
