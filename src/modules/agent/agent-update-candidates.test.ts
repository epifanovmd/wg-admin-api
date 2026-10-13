import { expect } from "chai";

import {
  newerVersion,
  sameVersion,
  updateCandidates,
} from "./agent-update-candidates";

const agent = (patch: Record<string, unknown> = {}): any => ({
  id: "a1",
  name: "node-1",
  labels: {},
  online: true,
  revoked: false,
  enrolledAt: 1,
  workers: [],
  hello: {
    agent: { version: "2.0.0", bootId: "b", startedAt: 1, updateMode: "self" },
    host: { os: "linux", arch: "amd64", hostname: "node-1" },
    workers: [],
  },
  ...patch,
});

const artifact = (name: string, version: string, arch = "amd64") => ({
  name,
  version,
  os: "linux",
  arch,
  file: `${name}-${version}-linux-${arch}`,
  sha256: "00",
  url: `/api/v1/agent-link/releases/${name}-${version}-linux-${arch}`,
});

describe("кандидаты на обновление", () => {
  it("версии: semver, v-префикс, предварительные версии", () => {
    expect(newerVersion("2.1.0", "2.0.9")).to.equal(true);
    expect(newerVersion("v2.0.0", "2.0.0-rc.1")).to.equal(true);
    expect(newerVersion("2.0.0-rc.2", "2.0.0-rc.10")).to.equal(false);
    expect(newerVersion("1.10.0", "1.9.0")).to.equal(true);
    expect(newerVersion("dev", "1.0.0")).to.equal(false);
    expect(newerVersion("1.0.0", "dev")).to.equal(true);
    expect(sameVersion("v1.2.0", "1.2")).to.equal(true);
    expect(sameVersion("dev", "dev")).to.equal(true);
  });

  it("агент — до новой версии, которую нашёл сам (update.latest)", () => {
    const { agents } = updateCandidates(
      [agent({ update: { latest: "2.1.0", checkedAt: 5 } })],
      null,
    );

    expect(agents).to.deep.equal([
      {
        agentId: "a1",
        agentName: "node-1",
        online: true,
        os: "linux",
        arch: "amd64",
        current: "2.0.0",
        target: "2.1.0",
      },
    ]);
  });

  it("агент без новой версии, не обновляющий себя сам, отозванный или без hello — не кандидат", () => {
    const update = { latest: "2.1.0", checkedAt: 5 };
    const external = agent({ update });

    external.hello.agent.updateMode = "external";

    expect(
      updateCandidates(
        [
          agent(),
          agent({ update: { latest: "2.0.0", checkedAt: 5 } }),
          external,
          agent({ update, revoked: true }),
          agent({ update, hello: undefined }),
        ],
        null,
      ).agents,
    ).to.deep.equal([]);
  });

  it("агент без updateMode обновляет себя сам", () => {
    const old = agent({ update: { latest: "2.1.0", checkedAt: 5 } });

    delete old.hello.agent.updateMode;
    expect(updateCandidates([old], null).agents).to.have.length(1);
  });

  it("воркер со сборкой с сервера — до новейшей сборки под платформу агента", () => {
    const release: any = {
      version: "2.0.0",
      artifacts: [],
      workers: [
        artifact("wg", "1.1.0"),
        artifact("wg", "1.2.0"),
        artifact("wg", "1.3.0", "arm64"),
        artifact("socks", "1.0.0"),
        artifact("probe", "2.0.0"),
      ],
    };
    const { workers } = updateCandidates(
      [
        agent({
          workers: [
            { name: "wg", version: "1.1.0", release: true },
            { name: "socks", version: "1.0.0", release: true },
            { name: "probe", version: "1.0.0" },
          ],
        }),
      ],
      release,
    );

    expect(workers).to.deep.equal([
      {
        agentId: "a1",
        agentName: "node-1",
        online: true,
        os: "linux",
        arch: "amd64",
        worker: "wg",
        current: "1.1.0",
        target: "1.2.0",
      },
    ]);
  });
});
