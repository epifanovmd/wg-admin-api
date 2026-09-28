import { inject } from "inversify";

import { config } from "../../config";
import { Injectable } from "../../core";
import { WgAgentBinaryService } from "../wg-agent";
import { IAppVersionDto } from "./app-info.dto";

/** Сведения о запущенном бэкенде. */
@Injectable()
export class AppInfoService {
  private readonly _startedAt = new Date(
    Date.now() - process.uptime() * 1000,
  ).toISOString();

  constructor(
    @inject(WgAgentBinaryService)
    private readonly _agentBinaries: Pick<WgAgentBinaryService, "release">,
    private readonly _app: typeof config.app = config.app,
  ) {}

  async version(): Promise<IAppVersionDto> {
    const agent = await this._agentBinaries.release();

    return {
      version: this._app.version,
      commit: this._app.commit,
      builtAt: this._app.builtAt,
      startedAt: this._startedAt,
      agentVersion: agent.version,
    };
  }
}
