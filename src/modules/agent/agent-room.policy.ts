import { inject } from "inversify";

import { Agents, Injectable } from "../../core";
import { ISocketRoomPolicy } from "../socket";
import { AGENT_ROOM_TYPE, agentRoom, isAgentId } from "./agent.types";
import { AgentAccessService } from "./agent-access.service";

/**
 * Комната агента `agent_<id>` (`room:subscribe { type: "agent", id }`): доступ на просмотр и
 * агент существует. Пока клиент в комнате, агент под наблюдением (`AgentWatchService`).
 */
@Injectable()
export class AgentRoomPolicy implements ISocketRoomPolicy {
  readonly type = AGENT_ROOM_TYPE;

  constructor(
    @inject(AgentAccessService) private readonly _access: AgentAccessService,
    @inject(Agents) private readonly _agents: Agents,
  ) {}

  room(id: string): string {
    return agentRoom(id);
  }

  async canJoin(userId: string, id: string): Promise<boolean> {
    return (
      isAgentId(id) &&
      (await this._access.canUser(userId, id, "view")) &&
      !!(await this._agents.find(id))
    );
  }
}
