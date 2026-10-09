import "./agent.permissions";

import { asJobHandler, Module, RAW_HTTP_HANDLER } from "../../core";
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
import { AgentRuntime } from "./agent.runtime";
import { AgentService } from "./agent.service";
import { AgentSignals } from "./agent.signals";
import { AGENTS_ROOM } from "./agent.types";
import { AgentAccessService } from "./agent-access.service";
import { AgentEnrollmentController } from "./agent-enrollment.controller";
import { AgentEnrollmentService } from "./agent-enrollment.service";
import { AgentEnrollmentToken } from "./agent-enrollment-token.entity";
import { AgentEnrollmentTokenRepository } from "./agent-enrollment-token.repository";
import { AgentHistoryService } from "./agent-history.service";
import { AgentLinkHandler } from "./agent-link.handler";
import { AgentPruneJob } from "./agent-prune.job";
import { AgentRelayServer } from "./agent-relay.server";
import { AgentReleaseController } from "./agent-release.controller";
import { AgentRoomPolicy } from "./agent-room.policy";
import { AgentWatchService } from "./agent-watch.service";
import { AgentWorkerController } from "./agent-worker.controller";
import { AgentWorkerService } from "./agent-worker.service";
import { AgentWorkerEvent } from "./agent-worker-event.entity";
import { AgentWorkerEventRepository } from "./agent-worker-event.repository";
import { AgentStore } from "./store/agent.store";
import { StoredAgent } from "./store/stored-agent.entity";
import { StoredAgentConfig } from "./store/stored-agent-config.entity";

/**
 * Агенты на agent-sdk: регистрация по токенам, связь по WebSocket, воркеры
 * (статус, манифест, перезапуск, обновление, настройки, запросы), события
 * воркеров, журнал, выпуск и установка.
 */
@Module({
  entities: [
    StoredAgent,
    StoredAgentConfig,
    AgentWorkerEvent,
    AgentEnrollmentToken,
  ],
  providers: [
    AgentStore,
    AgentSignals,
    AgentWorkerEventRepository,
    AgentHistoryService,
    AgentEnrollmentTokenRepository,
    AgentEnrollmentService,
    AgentAccessService,
    AgentRuntime,
    AgentService,
    AgentWorkerService,
    AgentWatchService,
    AgentRelayServer,
    AgentController,
    AgentWorkerController,
    AgentEnrollmentController,
    AgentReleaseController,
    { provide: RAW_HTTP_HANDLER, useClass: AgentLinkHandler },
    asSocketHandler(AgentSocketHandler),
    asSocketListener(AgentListener),
    asSocketRoomPolicy(
      permissionRoomPolicy(AGENTS_ROOM, AgentPermissions.VIEW),
    ),
    asSocketRoomPolicy(AgentRoomPolicy),
    asJobHandler(AgentPruneJob),
  ],
  bootstrappers: [AgentBootstrap],
})
export class AgentModule {}
