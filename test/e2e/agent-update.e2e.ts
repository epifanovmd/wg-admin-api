import { expect } from "chai";
import { execFileSync } from "child_process";
import { createServer } from "http";
import { AddressInfo } from "net";

import {
  AGENT_PREVIOUS_VERSION,
  AGENT_RELEASES_URL,
  AGENT_VERSION,
  agentBinary,
  authorPublicKey,
  mirrorRequests,
  PLATFORM,
  PROJECT_PUBLIC_KEY,
  realAgentAvailable,
} from "./agent-release";
import { Actor, call, eventually, expectStatus, signInAdmin } from "./client";
import { BASE_URL, E2E_BOOTSTRAP_TOKEN } from "./harness";
import { RealAgent } from "./real-agent";

/**
 * Сборки агента: агент и netprobe — из удалённого источника (сервер стенда
 * вместо GitHub, `AGENT_RELEASES_URL`), воркеры проекта wg и socks — из
 * каталога проекта с подписью ключом проекта. Установщик знает оба ключа,
 * воркеры проекта обновляются, прежний агент видит обновление и
 * обновляется до версии источника.
 */
describe("сборки агента: источник агента и воркеры проекта", function () {
  this.timeout(120_000);

  let admin: Actor;
  const agents: RealAgent[] = [];

  const release = async () =>
    expectStatus(await call(admin, "GET", "/api/v1/agent-releases"), 200).data;

  const agentRecord = async (id: string) =>
    expectStatus(await call(admin, "GET", `/api/v1/agents/${id}`), 200).data;

  before(async function () {
    if (!realAgentAvailable() || !AGENT_RELEASES_URL) this.skip();
    admin = await signInAdmin();
  });

  after(async () => {
    await Promise.all(agents.map(agent => agent.stop()));
  });

  it("итоговый манифест: агент и netprobe из источника, wg и socks — из каталога проекта", async () => {
    const { manifest } = await release();

    expect(manifest.version).to.equal(AGENT_VERSION);
    expect(manifest.remote).to.include({
      version: AGENT_VERSION,
      from: AGENT_RELEASES_URL,
    });
    expect(manifest.remote.publicKey).to.equal(authorPublicKey());
    expect(manifest.artifacts).to.have.length.greaterThan(0);
    expect(
      manifest.artifacts.every((a: any) => a.source === "remote"),
    ).to.equal(true);

    const workers = manifest.workers.map((w: any) => `${w.name}:${w.source}`);

    expect(workers).to.include.members([
      "wg:local",
      "socks:local",
      "netprobe:remote",
    ]);

    const info = expectStatus(
      await call(admin, "GET", "/api/v1/app/version"),
      200,
    ).data;

    expect(info.agentVersion).to.equal(AGENT_VERSION);
  });

  it("установка с сервера: скрипт и архив папки агента (ключ проекта — в нём); сборка агента — перенаправление на источник", async () => {
    const script = await (
      await fetch(`${BASE_URL}/api/v1/agent-bundle/install.sh`)
    ).text();

    expect(script).to.include(`SERVER='${BASE_URL}'`);
    expect(script).to.include('install --server "$SERVER" "$@"');

    const archive = await fetch(
      `${BASE_URL}/api/v1/agent-bundle/${PLATFORM}.tar.gz`,
    );

    expect(archive.status).to.equal(200);
    const info = JSON.parse(
      execFileSync("tar", ["-xzOf", "-", "agent/bundle.json"], {
        input: Buffer.from(await archive.arrayBuffer()),
      }).toString("utf8"),
    );

    expect(info).to.include({
      version: AGENT_VERSION,
      config: "agent.prod.yaml",
      env: "prod",
    });
    expect(info.publicKeys).to.deep.equal([PROJECT_PUBLIC_KEY]);
    expect(info.workers).to.have.members(["wg", "socks"]);

    const file = await fetch(
      `${BASE_URL}/api/v1/agent-link/releases/agent-${PLATFORM}`,
      { redirect: "manual" },
    );

    expect(file.status).to.equal(302);
    expect(file.headers.get("location")).to.equal(
      `${AGENT_RELEASES_URL}/agent-${PLATFORM}`,
    );
  });

  it("агент версии источника: воркер проекта обновляется (подпись ключом проекта)", async () => {
    const agent = await RealAgent.start({
      token: E2E_BOOTSTRAP_TOKEN,
      name: "release-current",
      workerVersion: "0.0.1",
      update: true,
      updateKeys: [PROJECT_PUBLIC_KEY],
    });

    agents.push(agent);

    const agentId = agent.agentId;
    const wgVersion = (await release()).manifest.workers.find(
      (w: any) => w.name === "wg" && w.source === "local",
    ).version;

    await eventually(
      async () =>
        (await release()).workerCandidates.find(
          (c: any) => c.agentId === agentId && c.worker === "wg",
        ),
      { timeoutMs: 30_000, what: "обновление воркера wg видно" },
    );
    expect(
      (await release()).candidates.map((c: any) => c.agentId),
    ).to.not.include(agentId);

    const updated = expectStatus(
      await call(
        admin,
        "POST",
        `/api/v1/agents/${agentId}/workers/wg/update`,
        {},
      ),
      200,
    ).data;

    expect(updated).to.include({ version: wgVersion });
    await eventually(
      async () => {
        const wg = (await agentRecord(agentId)).workers.find(
          (w: any) => w.name === "wg",
        );

        return wg?.state === "running" && wg.version === wgVersion;
      },
      { timeoutMs: 30_000, what: "wg новой версии работает" },
    );
  });

  it("прежний агент: обновление видно, агент обновляется до версии источника", async function () {
    if (
      AGENT_PREVIOUS_VERSION === AGENT_VERSION ||
      !agentBinary(AGENT_PREVIOUS_VERSION)
    ) {
      // Прежний агент — yarn agent:fetch <версия>.
      this.skip();
    }

    const agent = await RealAgent.start({
      token: E2E_BOOTSTRAP_TOKEN,
      name: "release-previous",
      version: AGENT_PREVIOUS_VERSION,
      update: true,
    });

    agents.push(agent);

    const agentId = agent.agentId;
    const candidate = await eventually(
      async () =>
        (await release()).candidates.find((c: any) => c.agentId === agentId),
      { timeoutMs: 30_000, what: "обновление агента видно" },
    );

    expect(candidate).to.include({
      current: AGENT_PREVIOUS_VERSION,
      target: AGENT_VERSION,
      source: "server",
    });

    const updated = expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/update`),
      200,
    ).data;

    expect(updated).to.deep.equal({
      version: AGENT_VERSION,
      previous: AGENT_PREVIOUS_VERSION,
    });
    await eventually(
      async () => {
        const record = await agentRecord(agentId);

        return record.online && record.version === AGENT_VERSION;
      },
      { timeoutMs: 30_000, what: "агент на связи с новой версией" },
    );
    expect(agent.version()).to.equal(AGENT_VERSION);
    expect(mirrorRequests).to.include(
      `/download/v${AGENT_VERSION}/agent-${PLATFORM}`,
    );
  });

  it("новую версию нашёл сам агент: update агента и кандидат source=agent", async () => {
    const next = AGENT_VERSION.replace(/(\d+)$/, p => `${Number(p) + 1}`);
    // Свой каталог сборок агента: новее только для него — сервер её не видит.
    const catalog = createServer((req, res) => {
      if (!req.url?.endsWith("/latest/download/manifest.json")) {
        res.writeHead(404).end();

        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ version: next, artifacts: [] }));
    });

    await new Promise<void>(r => catalog.listen(0, "127.0.0.1", r));

    try {
      const agent = await RealAgent.start({
        token: E2E_BOOTSTRAP_TOKEN,
        name: "release-self-check",
        updateReleases: `http://127.0.0.1:${(catalog.address() as AddressInfo).port}`,
      });

      agents.push(agent);
      await eventually(
        async () => (await agentRecord(agent.agentId)).update?.latest === next,
        { timeoutMs: 30_000, what: "агент сообщил новую версию" },
      );
      expect(
        (await release()).candidates.find(
          (c: any) => c.agentId === agent.agentId,
        ),
      ).to.include({ current: AGENT_VERSION, target: next, source: "agent" });
    } finally {
      catalog.close();
    }
  });
});
