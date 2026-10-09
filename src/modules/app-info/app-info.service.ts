import { inject } from "inversify";

import { config } from "../../config";
import { Injectable } from "../../core";
import { AgentService } from "../agent";
import { IAppVersionDto } from "./app-info.dto";

/** Сведения о запущенном бэкенде. */
@Injectable()
export class AppInfoService {
  private readonly _startedAt = new Date(
    Date.now() - process.uptime() * 1000,
  ).toISOString();

  constructor(
    @inject(AgentService)
    private readonly _agents: Pick<AgentService, "releaseVersion">,
    private readonly _app: typeof config.app = config.app,
  ) {}

  async version(): Promise<IAppVersionDto> {
    return {
      version: this._app.version,
      commit: this._app.commit,
      builtAt: this._app.builtAt,
      startedAt: this._startedAt,
      agentVersion: await this._agents.releaseVersion(),
    };
  }
}
