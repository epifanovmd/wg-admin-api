import { LINK_PATH } from "agent-sdk";
import { AgentsError, sendJSON } from "agent-sdk/server";
import type { IncomingMessage, ServerResponse } from "http";
import { inject } from "inversify";

import { Injectable, IRawHttpHandler, logger } from "../../core";
import { AgentRuntime } from "./agent.runtime";

const pathOf = (url: string | undefined): string => (url ?? "/").split("?")[0];

const isLinkPath = (path: string): boolean =>
  path === LINK_PATH || path.startsWith(`${LINK_PATH}/`);

/**
 * HTTP-маршруты агентов `/api/v1/agent-link/*` (регистрация, выпуск,
 * `install.sh`) — до разбора тела, CORS и лимита запросов: тело и ответ
 * ведёт SDK. WebSocket пути агентов подключает `AgentBootstrap`; пересылку
 * между копиями — внутренний сервер `AgentRelayServer`.
 */
@Injectable()
export class AgentLinkHandler implements IRawHttpHandler {
  constructor(@inject(AgentRuntime) private readonly _runtime: AgentRuntime) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!isLinkPath(pathOf(req.url))) return false;

    try {
      return await this._runtime.handle(req, res);
    } catch (err) {
      const error =
        err instanceof AgentsError
          ? err
          : new AgentsError("INTERNAL", "Ошибка канала агентов", 500);

      if (error.status >= 500) logger.error({ err }, "[Agent] Канал агентов");
      if (!res.headersSent) {
        sendJSON(res, error.status, {
          code: error.code,
          message: error.message,
        });
      } else res.destroy();

      return true;
    }
  }
}
