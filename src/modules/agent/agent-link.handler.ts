import { LINK_PATH } from "agent-sdk/server";
import type { IncomingMessage, ServerResponse } from "http";
import { inject } from "inversify";

import { Injectable, IRawHttpHandler } from "../../core";
import { agentConfig } from "./agent.config";
import { AgentRuntime } from "./agent.runtime";
import { serveBundle } from "./agent-bundle";

const pathOf = (url: string | undefined): string => (url ?? "/").split("?")[0];

const isLinkPath = (path: string): boolean =>
  path === LINK_PATH || path.startsWith(`${LINK_PATH}/`);

/**
 * HTTP-маршруты агентов `/api/v1/agent-link/*` — до разбора тела, CORS и
 * лимита запросов: регистрация и сборки ведёт SDK (ошибки отвечает сам),
 * установку из архивов (`bundle/*`) — `serveBundle`. WebSocket пути агентов
 * подключает `AgentBootstrap`.
 */
@Injectable()
export class AgentLinkHandler implements IRawHttpHandler {
  constructor(@inject(AgentRuntime) private readonly _runtime: AgentRuntime) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = pathOf(req.url);

    if (!isLinkPath(path)) return false;

    return (
      (await serveBundle(agentConfig.bundleDir, req, res, path)) ||
      this._runtime.handle(req, res)
    );
  }
}
