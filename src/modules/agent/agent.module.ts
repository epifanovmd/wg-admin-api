import "./agent.permissions";

import { AgentCoreModule, Module } from "../../core";
import {
  asSocketHandler,
  asSocketListener,
  asSocketRoomPolicy,
  permissionRoomPolicy,
} from "../socket";
import { AgentBootstrap } from "./agent.bootstrap";
import { AgentController } from "./agent.controller";
import { AgentSocketHandler } from "./agent.handler";
import { AgentListener } from "./agent.listener";
import { AgentPermissions } from "./agent.permissions";
import { AgentService } from "./agent.service";
import { AGENTS_ROOM } from "./agent.types";
import { AgentAccessService } from "./agent-access.service";
import { AgentEnrollmentController } from "./agent-enrollment.controller";
import { AgentRoomPolicy } from "./agent-room.policy";
import { AgentWatchService } from "./agent-watch.service";
import { AgentWorkerController } from "./agent-worker.controller";

/**
 * Агенты для веба: REST, сокеты (комнаты `agents` и `agent_<id>`), права, наблюдение. Работа с
 * агентами — ядро (`AgentCoreModule`, `Agents`).
 */
@Module({
  imports: [AgentCoreModule],
  providers: [
    AgentAccessService,
    AgentService,
    AgentWatchService,
    AgentController,
    AgentWorkerController,
    AgentEnrollmentController,
    asSocketHandler(AgentSocketHandler),
    asSocketListener(AgentListener),
    asSocketRoomPolicy(
      permissionRoomPolicy(AGENTS_ROOM, AgentPermissions.VIEW),
    ),
    asSocketRoomPolicy(AgentRoomPolicy),
  ],
  bootstrappers: [AgentBootstrap],
})
export class AgentModule {}
