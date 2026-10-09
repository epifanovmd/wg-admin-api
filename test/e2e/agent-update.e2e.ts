import { expect } from "chai";

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
 * Выпуск агента: агент и netprobe — из удалённого источника (сервер стенда
 * вместо GitHub, `AGENT_RELEASES_URL`), воркеры проекта wg и socks — из
 * каталога проекта с подписью ключом проекта. Установщик знает оба ключа,
 * воркеры проекта обновляются, прежний агент видит обновление и
 * обновляется до версии источника.
 */
describe("выпуск агента: источник агента и воркеры проекта", function () {
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

  it("итоговый выпуск: агент и netprobe из источника, wg и socks — из каталога проекта", async () => {
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

  it("install.sh из источника: адрес бэкенда, ключи проекта и автора агента; сборка агента — перенаправление на источник", async () => {
    const script = await (
      await fetch(`${BASE_URL}/api/v1/agent-link/install.sh`)
    ).text();

    expect(script).to.match(new RegExp(`^DEFAULT_SERVER="${BASE_URL}"$`, "m"));
    expect(script).to.include(
      `DEFAULT_UPDATE_KEYS="${PROJECT_PUBLIC_KEY} ${authorPublicKey()}"`,
    );

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
      // Прежний агент — agent/fetch-agent.sh <версия>.
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
});
