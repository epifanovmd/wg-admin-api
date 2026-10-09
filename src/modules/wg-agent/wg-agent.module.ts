import { asJobHandler, Module } from "../../core";
import { asSocketListener } from "../socket";
import { WgAgentBootstrap } from "./wg-agent.bootstrap";
import { WgAgentListener } from "./wg-agent.listener";
import { WgAgentStateService } from "./wg-agent-state.service";
import { WgAgentSyncJob } from "./wg-agent-sync.job";
import { WgAgentSyncService } from "./wg-agent-sync.service";
import { WgAgentTelemetryService } from "./wg-agent-telemetry.service";
import { WgAgentWatchService } from "./wg-agent-watch.service";
import { WgNodeSignals } from "./wg-node-signals";

/**
 * Связь WG-домена с агентами нод (agent-sdk): настройки воркеров `wg` и
 * `socks` из БД, их итоги, метрики и события — обратно в домен.
 */
@Module({
  providers: [
    WgNodeSignals,
    WgAgentStateService,
    WgAgentSyncService,
    WgAgentTelemetryService,
    WgAgentWatchService,
    asSocketListener(WgAgentListener),
    asJobHandler(WgAgentSyncJob),
  ],
  bootstrappers: [WgAgentBootstrap],
})
export class WgAgentModule {}
