import { inject } from "inversify";
import { DataSource } from "typeorm";

import { Injectable, PgSignals } from "../../core";
import { AGENTS_CHANGED_CHANNEL } from "./agent.types";

const CHANNELS = [AGENTS_CHANGED_CHANNEL] as const;

export type TAgentSignalChannel = (typeof CHANNELS)[number];

/**
 * Сигналы агентов между процессами (LISTEN/NOTIFY): изменения в Store — по
 * ним процесс с соединением агента вызывает `refresh`.
 */
@Injectable()
export class AgentSignals extends PgSignals<TAgentSignalChannel> {
  constructor(@inject(DataSource) dataSource: DataSource) {
    super(dataSource, CHANNELS, "agent-signals");
  }
}
