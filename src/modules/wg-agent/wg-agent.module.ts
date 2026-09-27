import { asJobHandler, Module } from "../../core";
import { WgAgentController } from "./wg-agent.controller";
import { WgAgentBinaryService } from "./wg-agent-binary.service";
import { WgAgentLinkGateway } from "./wg-agent-link.gateway";
import { WgAgentLinkLostJob } from "./wg-agent-link-lost.job";
import { WgAgentSessionService } from "./wg-agent-session.service";
import { WgAgentStateService } from "./wg-agent-state.service";
import { WgAgentUpdateController } from "./wg-agent-update.controller";
import { WgNodeSignals, WgNodeSignalsBootstrap } from "./wg-node-signals";

@Module({
  providers: [
    WgNodeSignals,
    WgAgentBinaryService,
    WgAgentStateService,
    WgAgentSessionService,
    WgAgentController,
    WgAgentUpdateController,
    WgAgentLinkGateway,
    asJobHandler(WgAgentLinkLostJob),
  ],
  bootstrappers: [WgNodeSignalsBootstrap, WgAgentLinkGateway],
})
export class WgAgentModule {}
