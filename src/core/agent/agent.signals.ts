import { inject } from "inversify";
import { DataSource } from "typeorm";

import { PgSignals } from "../db";
import { Injectable } from "../decorators";

/** `agent_push` (id агента) — у агента новое желаемое или команда; `agent_result` — id команды с итогом. */
const CHANNELS = ["agent_push", "agent_result"] as const;

export type TAgentSignalChannel = (typeof CHANNELS)[number];

/** Сигналы агентов между копиями API: поток агента держит одна копия, писать может любая. */
@Injectable()
export class AgentSignals extends PgSignals<TAgentSignalChannel> {
  constructor(@inject(DataSource) dataSource: DataSource) {
    super(dataSource, CHANNELS, "agent-signals");
  }
}
