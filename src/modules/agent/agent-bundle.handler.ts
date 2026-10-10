import type { IncomingMessage, ServerResponse } from "http";
import { inject } from "inversify";

import { Injectable, IRawHttpHandler } from "../../core";
import { AgentService } from "./agent.service";
import { serveBundle } from "./agent-bundle";

/**
 * Архивы папки агента для узлов `/api/v1/agent-bundle/*`: скрипт установки
 * (`install.sh`) и архив под платформу узла (`linux-<arch>.tar.gz`) из
 * `AGENT_BUNDLE_DIR` — им ставят агента вручную, командой установки и по SSH.
 */
@Injectable()
export class AgentBundleHandler implements IRawHttpHandler {
  constructor(@inject(AgentService) private readonly _agents: AgentService) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return serveBundle(req, res, this._agents.publicUrl());
  }
}
