import { AgentsError, sendJSON } from "agent-sdk/server";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { inject } from "inversify";

import { Injectable, logger } from "../../core";
import { agentConfig } from "./agent.config";
import { AgentRuntime } from "./agent.runtime";
import { AGENT_RELAY_PATH } from "./agent.types";

/** Закрытие сервера пересылки не дольше, мс: дальше соединения рвутся. */
const CLOSE_TIMEOUT_MS = 5_000;

const pathOf = (url: string | undefined): string => (url ?? "/").split("?")[0];

/**
 * Внутренний HTTP-сервер пересылки вызовов агентов между копиями API:
 * отдельный порт (`AGENT_RELAY_PORT`) на внутреннем адресе
 * (`AGENT_RELAY_HOST`), единственный маршрут — `POST /internal/agent-relay`
 * (закрыт общим секретом `AGENT_RELAY_SECRET`, проверяет SDK). Публичный
 * порт API пересылку не обслуживает.
 */
@Injectable()
export class AgentRelayServer {
  private _server: Server | null = null;

  constructor(@inject(AgentRuntime) private readonly _runtime: AgentRuntime) {}

  /** Адрес, который слушает сервер; не запущен — `null`. */
  get address(): string | null {
    const address = this._server?.address();

    return address && typeof address === "object"
      ? `${address.address}:${address.port}`
      : null;
  }

  async start(): Promise<void> {
    if (this._server || !this._runtime.relayEnabled) return;

    const server = createServer((req, res) => void this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(agentConfig.relayPort, agentConfig.relayHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this._server = server;
    logger.info(
      { address: this.address, instance: this._runtime.instanceId },
      "[Agent] Сервер пересылки готов",
    );
  }

  async stop(): Promise<void> {
    const server = this._server;

    if (!server) return;

    this._server = null;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        server.closeAllConnections();
        resolve();
      }, CLOSE_TIMEOUT_MS);

      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      server.closeIdleConnections();
    });
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== "POST" || pathOf(req.url) !== AGENT_RELAY_PATH) {
      sendJSON(res, 404, { code: "NOT_FOUND", message: "Маршрута нет" });

      return;
    }

    try {
      if (!(await this._runtime.handleRelay(req, res)) && !res.headersSent) {
        sendJSON(res, 404, { code: "NOT_FOUND", message: "Маршрута нет" });
      }
    } catch (err) {
      const error =
        err instanceof AgentsError
          ? err
          : new AgentsError("INTERNAL", "Ошибка пересылки", 500);

      if (error.status >= 500) logger.error({ err }, "[Agent] Пересылка");
      if (!res.headersSent) {
        sendJSON(res, error.status, {
          code: error.code,
          message: error.message,
        });
      } else res.destroy();
    }
  }
}
