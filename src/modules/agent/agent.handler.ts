import { inject } from "inversify";
import { z } from "zod";

import { Injectable } from "../../core";
import { ISocketHandler, onValidated, TSocket } from "../socket";
import { AgentError } from "./agent.errors";
import { AGENT_ID_PATTERN, AGENT_LOG_LEVELS } from "./agent.types";
import { AgentWatchService } from "./agent-watch.service";

const LogLevelSchema = z.object({
  agentId: z.string().regex(AGENT_ID_PATTERN),
  level: z.enum(AGENT_LOG_LEVELS),
});

/** Входящие события клиента по агентам. */
@Injectable()
export class AgentSocketHandler implements ISocketHandler {
  constructor(
    @inject(AgentWatchService) private readonly _watch: AgentWatchService,
  ) {}

  onConnection(socket: TSocket): void {
    onValidated(
      socket,
      "agent:log-level",
      LogLevelSchema,
      ({ agentId, level }) => {
        if (!this._watch.setLogLevel(socket.id, agentId, level)) {
          throw AgentError.NOT_WATCHED();
        }
      },
      { rateLimit: { perSecond: 2, burst: 5 } },
    );
  }
}
