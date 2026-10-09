import { AgentsError } from "agent-sdk/server";
import { expect } from "chai";

import { HttpException } from "../../core";
import { AgentError, toAgentError, withRetryAfter } from "./agent.errors";

describe("ошибки агентов", () => {
  it("коды SDK → доменные; агент в другом процессе — 503 с retryAfter", () => {
    const notFound = toAgentError(
      new AgentsError("AGENT_NOT_FOUND", "нет", 404),
    ) as HttpException;
    const elsewhere = toAgentError(
      new AgentsError("AGENT_ELSEWHERE", "там", 421),
    ) as HttpException;
    const worker = toAgentError(
      new AgentsError("WORKER_UNAVAILABLE", "не отвечает", 502),
    ) as HttpException;

    expect(notFound.code).to.equal(AgentError.codes.NOT_FOUND);
    expect([elsewhere.status, elsewhere.code]).to.deep.equal([
      503,
      AgentError.codes.ELSEWHERE,
    ]);
    expect([worker.status, worker.code]).to.deep.equal([
      502,
      "WORKER_UNAVAILABLE",
    ]);
  });

  it("отказы по манифесту воркера — доменные коды с понятным статусом, текст SDK — в details.reason", () => {
    const cases: Array<[string, number, string]> = [
      ["ROUTE_UNDECLARED", 404, AgentError.codes.ROUTE_UNDECLARED],
      ["JOB_UNKNOWN", 409, AgentError.codes.JOB_UNKNOWN],
      ["REQUEST_INVALID", 400, AgentError.codes.REQUEST_INVALID],
      ["EVENT_UNDECLARED", 409, AgentError.codes.EVENT_UNDECLARED],
    ];

    for (const [code, status, domain] of cases) {
      const err = toAgentError(
        new AgentsError(code, `${code}: подробности`, 400),
      ) as HttpException;

      expect([err.status, err.code], code).to.deep.equal([status, domain]);
      expect(err.reason).to.deep.include({ reason: `${code}: подробности` });
    }
  });

  it("withRetryAfter: заголовок Retry-After только для AGENT_ELSEWHERE", async () => {
    const headers: Record<string, string> = {};
    const set = (name: string, value: string) => {
      headers[name] = value;
    };

    await withRetryAfter(set, () =>
      Promise.reject(AgentError.ELSEWHERE()),
    ).catch(() => undefined);
    expect(headers["Retry-After"]).to.equal("2");
  });
});
