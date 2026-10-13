import { inject } from "inversify";

import { config } from "../../config";
import { IBootstrap, Injectable } from "../../core";
import { WgAgentSyncService } from "./wg-agent-sync.service";
import { WgAgentWatchService } from "./wg-agent-watch.service";
import { WG_NODE_CHANGED_CHANNEL, WgNodeSignals } from "./wg-node-signals";

/**
 * Запуск связи домена с агентами на процессах API (роли `api|all`): сигналы
 * изменения нод (`wg_node_changed` после коммита) → запись настроек
 * воркеров, наблюдение по спросу зрителей, сверка всех нод при старте.
 */
@Injectable()
export class WgAgentBootstrap implements IBootstrap {
  readonly critical = false;

  private _offSignal: (() => void) | null = null;

  constructor(
    @inject(WgNodeSignals) private readonly _signals: WgNodeSignals,
    @inject(WgAgentSyncService) private readonly _sync: WgAgentSyncService,
    @inject(WgAgentWatchService) private readonly _watch: WgAgentWatchService,
  ) {}

  async initialize(): Promise<void> {
    if (config.app.role === "worker") return;

    this._offSignal = this._signals.on(WG_NODE_CHANGED_CHANNEL, nodeId =>
      this._sync.schedule(nodeId),
    );
    await this._signals.start();
    this._watch.start();
    this._sync.scheduleAll();
  }

  async destroy(): Promise<void> {
    this._offSignal?.();
    this._sync.stop();
    this._watch.stop();
    await this._signals.stop();
  }
}
