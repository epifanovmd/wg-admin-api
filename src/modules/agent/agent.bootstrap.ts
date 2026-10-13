import { inject } from "inversify";

import { config } from "../../config";
import { IBootstrap, Injectable } from "../../core";
import { AgentWatchService } from "./agent-watch.service";

/** Наблюдение за агентами для сокетов — на ролях с HTTP. */
@Injectable()
export class AgentBootstrap implements IBootstrap {
  readonly critical = false;

  constructor(
    @inject(AgentWatchService) private readonly _watch: AgentWatchService,
  ) {}

  async initialize(): Promise<void> {
    if (config.app.role !== "worker") this._watch.start();
  }

  async destroy(): Promise<void> {
    this._watch.stop();
  }
}
