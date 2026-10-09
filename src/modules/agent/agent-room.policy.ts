import { inject } from "inversify";

import { Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { AgentRuntime } from "./agent.runtime";
import { AGENT_ROOM_TYPE, agentRoom, isAgentId } from "./agent.types";
import { AgentAccessService } from "./agent-access.service";

/**
 * Комната агента `agent_<id>` (`room:subscribe { type: "agent", id }`):
 * право `agent:view` или доступ к агенту через политику (агент своего
 * узла), и агент существует. Пока клиент в комнате, сервер держит
 * наблюдателя (`AgentWatchService`): метрики и журнал приходят чаще.
 */
@Injectable()
export class AgentRoomPolicy implements ISocketRoomPolicy {
  readonly type = AGENT_ROOM_TYPE;

  constructor(
    @inject(AgentAccessService) private readonly _access: AgentAccessService,
    @inject(AgentRuntime) private readonly _runtime: AgentRuntime,
  ) {}

  room(id: string): string {
    return agentRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    return (
      isAgentId(id) &&
      (await this._access.canUser(userId, id, "view")) &&
      !!(await this._runtime.agents.getAgent(id))
    );
  }
}
