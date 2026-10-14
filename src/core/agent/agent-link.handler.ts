import type { IncomingMessage, ServerResponse } from "http";
import { inject } from "inversify";

import { config } from "../../config";
import { Injectable } from "../decorators";
import { logger } from "../logger";
import type { IRawHttpHandler } from "../routing";
import { AGENT_BUNDLE_PATH, serveAgentFiles } from "./agent-files";
import { AgentIssueService } from "./agent-issue.service";
import {
  AgentProtocolError,
  AgentProtocolService,
} from "./agent-protocol.service";
import { AgentStreams } from "./agent-streams";
import { AGENT_PROTOCOL_PREFIX, AgentProtocolCode } from "./protocol";

/** Одноразовая ссылка на архив с токеном. */
const ISSUED = new RegExp(
  `^${AGENT_BUNDLE_PATH}/issued/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);

/** Пределы тел запросов агента. */
const BODY_MAX = 4 * 1024 * 1024;
const ENROLL_BODY_MAX = 64 * 1024;

const sendJSON = (res: ServerResponse, status: number, body: unknown): void => {
  const raw = JSON.stringify(body);

  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
};

const readJSON = async (
  req: IncomingMessage,
  limit: number,
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit)
      throw new AgentProtocolError(
        413,
        "BODY_TOO_LARGE",
        `тело больше ${limit} байт`,
      );
    chunks.push(chunk as Buffer);
  }
  if (!size) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AgentProtocolError(
      400,
      AgentProtocolCode.MESSAGE_INVALID,
      "тело — не JSON",
    );
  }
};

const remoteIp = (req: IncomingMessage): string | null => {
  const forwarded = req.headers["x-forwarded-for"];

  if (config.server.trustProxy && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim() || null;
  }

  return req.socket.remoteAddress ?? null;
};

/**
 * HTTP протокола агента под `/agent/v1/*` (до разбора тела, CORS и лимита запросов):
 * регистрация, поток и опрос вниз, отправки вверх, архивы для узлов и каталог сборок воркеров.
 * В Swagger не попадает — описан в docs/PROTOCOL.md агента.
 */
@Injectable()
export class AgentLinkHandler implements IRawHttpHandler {
  constructor(
    @inject(AgentProtocolService)
    private readonly _protocol: AgentProtocolService,
    @inject(AgentStreams) private readonly _streams: AgentStreams,
    @inject(AgentIssueService) private readonly _issues: AgentIssueService,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://agent");

    if (!url.pathname.startsWith(`${AGENT_PROTOCOL_PREFIX}/`)) return false;
    try {
      if (await this.serveIssued(req, res, url.pathname)) return true;
      if (await serveAgentFiles(req, res, url.pathname)) return true;
      await this.route(req, res, url);
    } catch (err) {
      if (err instanceof AgentProtocolError) {
        sendJSON(res, err.status, { code: err.code, message: err.message });
      } else {
        logger.error(
          { err, path: url.pathname },
          "[Agent] Ошибка обработки запроса агента",
        );
        if (!res.headersSent)
          sendJSON(res, 500, {
            code: "INTERNAL",
            message: "внутренняя ошибка",
          });
        else res.end();
      }
    }

    return true;
  }

  /**
   * Одноразовая ссылка на архив с токеном: `GET /agent/v1/bundle/issued/{id}` — архив один
   * раз и до срока, иначе 410. Не наш путь — `false`.
   */
  private async serveIssued(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<boolean> {
    const match = ISSUED.exec(path);

    if (!match || req.method !== "GET") return false;
    const archive = await this._issues.download(match[1]);

    if (!archive) {
      sendJSON(res, 410, {
        code: "ISSUE_GONE",
        message: "ссылка уже использована или истекла — выдайте новую",
      });

      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Length": archive.data.length,
      "Content-Disposition": `attachment; filename="${archive.file}"`,
      "Cache-Control": "no-store",
    });
    res.end(archive.data);

    return true;
  }

  private async route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const path = url.pathname.slice(AGENT_PROTOCOL_PREFIX.length);
    const ip = remoteIp(req);

    if (req.method === "POST" && path === "/enroll") {
      sendJSON(
        res,
        200,
        await this._protocol.enroll(
          (await readJSON(req, ENROLL_BODY_MAX)) as never,
          ip,
        ),
      );

      return;
    }

    const agent = await this._protocol.authenticate(
      req.headers.authorization,
      ip,
    );
    const after = Number(url.searchParams.get("after")) || 0;

    if (req.method === "GET" && path === "/stream") {
      await this._streams.open(agent, after, res);

      return;
    }
    if (req.method === "GET" && path === "/poll") {
      const rev = Number(url.searchParams.get("rev")) || 0;
      const wait = (Number(url.searchParams.get("wait")) || 30) * 1000;

      sendJSON(res, 200, await this._streams.poll(agent, after, rev, wait));

      return;
    }
    if (req.method !== "POST") {
      sendJSON(res, 404, {
        code: "NOT_FOUND",
        message: `нет ${req.method} ${path}`,
      });

      return;
    }

    const body = (await readJSON(req, BODY_MAX)) as never;

    switch (path) {
      case "/hello":
        sendJSON(res, 200, await this._protocol.hello(agent, body));
        break;
      case "/state":
        await this._protocol.state(agent, body);
        sendJSON(res, 200, {});
        break;
      case "/results":
        sendJSON(res, 200, await this._protocol.results(agent, body));
        break;
      case "/events":
        sendJSON(res, 200, await this._protocol.events(agent, body));
        break;
      case "/metrics":
        await this._protocol.metrics(agent, body);
        sendJSON(res, 200, {});
        break;
      case "/logs":
        this._protocol.logs(agent, body);
        sendJSON(res, 200, {});
        break;
      case "/requests":
        sendJSON(res, 200, await this._protocol.request(agent, body));
        break;
      default:
        sendJSON(res, 404, { code: "NOT_FOUND", message: `нет POST ${path}` });
    }
  }
}
