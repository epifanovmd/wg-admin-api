import type { Agent, UpdateCandidate } from "agent-sdk/server";
import { expect } from "chai";

import { compareVersions, mergeUpdateCandidates } from "./agent-update";

const agent = (patch: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    name: "node-1",
    online: true,
    revoked: false,
    version: "1.2.1",
    host: { os: "linux", arch: "amd64", hostname: "n1" },
    workers: [],
    alerts: [],
    labels: {},
    enrolledAt: 0,
    ...patch,
  }) as Agent;

const server = (target: string): UpdateCandidate => ({
  agentId: "a1",
  name: "node-1",
  online: true,
  current: "1.2.1",
  target,
  os: "linux",
  arch: "amd64",
});

describe("agent-update", () => {
  it("compareVersions: числа по частям, пре-релиз младше релиза", () => {
    expect(compareVersions("1.3.0", "1.2.10")).to.be.greaterThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).to.be.greaterThan(0);
    expect(compareVersions("v1.2.1", "1.2.1")).to.equal(0);
    expect(compareVersions("1.3.0-rc.1", "1.3.0")).to.be.lessThan(0);
    expect(compareVersions("1.2.0", "1.3.0")).to.be.lessThan(0);
  });

  it("версия, которую агент нашёл сам, — кандидат, даже если сервер её не видел", () => {
    const now = Date.now();

    expect(
      mergeUpdateCandidates(
        [],
        [agent({ update: { latest: "1.3.0", checkedAt: now } })],
      ),
    ).to.deep.equal([
      {
        agentId: "a1",
        name: "node-1",
        online: true,
        current: "1.2.1",
        target: "1.3.0",
        os: "linux",
        arch: "amd64",
        source: "agent",
      },
    ]);
  });

  it("из двух целей — новейшая; не новее текущей и отозванные — не кандидаты", () => {
    const found = agent({ update: { latest: "1.3.0", checkedAt: 1 } });

    expect(
      mergeUpdateCandidates([server("1.3.0")], [found]).map(c => c.source),
    ).to.deep.equal(["server"]);
    expect(
      mergeUpdateCandidates([server("1.2.5")], [found]).map(c => c.target),
    ).to.deep.equal(["1.3.0"]);
    expect(
      mergeUpdateCandidates(
        [],
        [agent({ update: { latest: "1.2.1", checkedAt: 1 } })],
      ),
    ).to.deep.equal([]);
    expect(
      mergeUpdateCandidates(
        [],
        [agent({ revoked: true, update: { latest: "1.3.0", checkedAt: 1 } })],
      ),
    ).to.deep.equal([]);
  });
});
