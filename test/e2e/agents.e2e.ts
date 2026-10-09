import { expect } from "chai";

import { AGENT_VERSION, realAgentAvailable } from "./agent-release";
import {
  Actor,
  call,
  eventually,
  expectStatus,
  items,
  signIn,
  signInAdmin,
  signUp,
} from "./client";
import { BASE_URL } from "./harness";
import { RealAgent } from "./real-agent";

/**
 * Настоящий агент из выпуска с GitHub и воркеры проекта (wg в режиме
 * `WG_DRY_RUN`, socks) из выпуска стенда (`agent-release.ts`): установка на ноду по токену, желаемое
 * состояние и итог применения, метрики пиров, перезапуск интерфейса через
 * воркер, журнал, настройки и запросы к воркерам, токены регистрации,
 * действия над агентом, привязка, отзыв и удаление.
 */
describe("агент ноды: настоящий агент и воркер wg (dry-run)", function () {
  this.timeout(120_000);

  let admin: Actor;
  let user: Actor;
  let node: any;
  let agent: RealAgent | null = null;
  let agentId: string;
  let iface: any;
  let peer: any;

  const nodeById = async (id: string) =>
    expectStatus(await call(admin, "GET", `/api/v1/wg/nodes/${id}`), 200).data;

  const agentRecord = async () =>
    expectStatus(await call(admin, "GET", `/api/v1/agents/${agentId}`), 200)
      .data;

  before(async function () {
    if (!realAgentAvailable()) {
      // Без агента (`agent/fetch-agent.sh`) и воркеров (`yarn agent:release`)
      // сценарии с настоящим агентом пропускаются.
      this.skip();
    }
    admin = await signInAdmin();
    user = await signUp("agents-user");
  });

  after(async () => {
    await agent?.stop();
  });

  it("токены регистрации: выпуск, список без секрета, отзыв; отозванный — 401", async () => {
    const created = expectStatus(
      await call(admin, "POST", "/api/v1/agent-enrollment-tokens", {
        name: "e2e-token",
        maxUses: 1,
      }),
      201,
    ).data;

    expect(created.token).to.include(".");

    const list = expectStatus(
      await call(admin, "GET", "/api/v1/agent-enrollment-tokens"),
      200,
    ).data;

    expect(JSON.stringify(list)).to.not.include(created.token.split(".")[1]);
    expectStatus(
      await call(
        admin,
        "POST",
        `/api/v1/agent-enrollment-tokens/${created.enrollmentToken.id}/revoke`,
      ),
      204,
    );

    const enroll = await fetch(`${BASE_URL}/api/v1/agent-link/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: created.token,
        name: "x",
        host: { os: "linux", arch: "amd64", hostname: "x" },
      }),
    });

    expect(enroll.status).to.equal(401);
    expectStatus(
      await call(user, "GET", "/api/v1/agent-enrollment-tokens"),
      403,
    );
  });

  it("установка на ноду: агент регистрируется по токену ноды, нода online, воркеры wg и socks", async () => {
    const created = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", {
        name: "real-node",
        publicHost: "203.0.113.150",
      }),
      201,
    ).data;

    node = created.node;
    agent = await RealAgent.start({
      token: created.install.token,
      name: "real-node",
    });
    agentId = agent.agentId;

    const online = await eventually(
      async () => {
        const current = await nodeById(node.id);

        return current.status === "online" ? current : null;
      },
      { timeoutMs: 30_000, what: "нода online" },
    );

    expect(online.agentId).to.equal(agentId);
    expect(online.agentVersion).to.equal(AGENT_VERSION);
    expect(online.wgVersion).to.equal("dry-run");

    const record = await agentRecord();
    const wg = record.workers.find((w: any) => w.name === "wg");

    expect(wg.state).to.equal("running");
    expect(wg.manifest.configs.map((c: any) => c.key)).to.deep.equal([
      "state",
      "probes",
    ]);
    expect(record.workers.find((w: any) => w.name === "socks").state).to.equal(
      "running",
    );
    expect(record.labels.nodeId).to.equal(node.id);

    const list = expectStatus(await call(admin, "GET", "/api/v1/agents"), 200);

    expect(items(list.data).map((a: any) => a.id)).to.include(agentId);
    expectStatus(await call(admin, "GET", "/api/v1/agents/alerts"), 200);
    // Агент чужой ноды не раскрывается.
    expectStatus(await call(user, "GET", `/api/v1/agents/${agentId}`), 404);
  });

  it("желаемое состояние: интерфейс с пиром применён, итог — статус интерфейса и версия", async () => {
    iface = expectStatus(
      await call(admin, "POST", "/api/v1/wg/interfaces", {
        nodeId: node.id,
        name: "wg0",
        listenPort: 51830,
        addressCidr: "10.30.0.1/24",
      }),
      201,
    ).data;
    peer = expectStatus(
      await call(admin, "POST", "/api/v1/wg/peers", {
        interfaceId: iface.id,
        name: "real-peer",
      }),
      201,
    ).data;

    const synced = await eventually(
      async () => {
        const current = await nodeById(node.id);

        return current.inSync && current.appliedVersion > 0 ? current : null;
      },
      { timeoutMs: 30_000, what: "состояние применено" },
    );

    expect(synced.applyError).to.equal(null);

    const up = await eventually(async () => {
      const res = await call(admin, "GET", `/api/v1/wg/interfaces/${iface.id}`);

      return res.data.status === "up" ? res.data : null;
    });

    expect(up.status).to.equal("up");

    const configs = expectStatus(
      await call(admin, "GET", `/api/v1/agents/${agentId}/configs?worker=wg`),
      200,
    ).data;
    const state = configs.find((c: any) => c.key === "state");

    expect(state.status.state).to.equal("applied");
    expect(state.status.result.interfaces).to.deep.include({
      name: "wg0",
      status: "up",
    });

    const entry = expectStatus(
      await call(
        admin,
        "GET",
        `/api/v1/agents/${agentId}/workers/wg/configs/state`,
      ),
      200,
    ).data;

    expect(entry.config.data.interfaces[0].peers).to.have.length(1);
    expect(entry.config.data.version).to.equal(synced.configVersion);
  });

  it("настройки без права на них: статус и версия видны, значение (ключи WireGuard) — нет", async () => {
    const viewer = await signUp("agents-viewer");

    expectStatus(
      await call(admin, "PATCH", `/api/v1/user/setPrivileges/${viewer.id}`, {
        roles: ["user"],
        permissions: ["wg:node:view"],
      }),
      200,
    );

    const actor = await signIn(viewer.email, viewer.password);
    const configs = expectStatus(
      await call(actor, "GET", `/api/v1/agents/${agentId}/configs?worker=wg`),
      200,
    ).data;
    const state = configs.find((c: any) => c.key === "state");

    expect(state.status.state).to.equal("applied");
    expect(state.config.version).to.be.a("number");
    expect(state.config).to.not.have.property("data");

    const entry = expectStatus(
      await call(
        actor,
        "GET",
        `/api/v1/agents/${agentId}/workers/wg/configs/state`,
      ),
      200,
    ).data;

    expect(entry.config).to.not.have.property("data");
  });

  it("метрики воркера wg: статистика пира и окна скорости", async () => {
    const live = await eventually(
      async () => {
        const res = await call(admin, "GET", `/api/v1/wg/peers/${peer.id}`);

        return res.data.lastHandshakeAt ? res.data : null;
      },
      { timeoutMs: 30_000, what: "статистика пира" },
    );

    expect(live.isOnline).to.equal(true);
    expectStatus(
      await call(admin, "GET", `/api/v1/wg/stats/window/peer/${peer.id}`),
      200,
    );
    expectStatus(
      await call(admin, "GET", `/api/v1/wg/stats/window/interface/${iface.id}`),
      200,
    );
    expectStatus(
      await call(admin, "GET", `/api/v1/wg/stats/window/node/${node.id}`),
      200,
    );
  });

  it("перезапуск интерфейса — запрос к воркеру wg; журнал агента и воркера", async () => {
    const restarted = expectStatus(
      await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/restart`),
      200,
    ).data;

    expect(restarted).to.deep.equal({ name: "wg0", status: "up" });

    const logs = expectStatus(
      await call(admin, "GET", `/api/v1/wg/nodes/${node.id}/logs?lines=100`),
      200,
    ).data;

    expect(logs.entries.length).to.be.greaterThan(0);
    expectStatus(
      await call(
        admin,
        "GET",
        `/api/v1/agents/${agentId}/logs?worker=wg&lines=50`,
      ),
      200,
    );
    expectStatus(
      await call(admin, "GET", `/api/v1/agents/events?agentId=${agentId}`),
      200,
    );
  });

  it("запрос к воркеру и настройки: GET /state, своя настройка probes, удаление ключа", async () => {
    const res = await call(
      admin,
      "POST",
      `/api/v1/agents/${agentId}/workers/wg/fetch`,
      { method: "GET", path: "/state" },
    );

    expect(res.status).to.equal(200);
    expect(res.data.interfaces).to.deep.include({ name: "wg0", status: "up" });

    // Необъявленный маршрут агент не пропускает.
    expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/workers/wg/fetch`, {
        method: "GET",
        path: "/nope",
      }),
      404,
    );

    const put = expectStatus(
      await call(
        admin,
        "PUT",
        `/api/v1/agents/${agentId}/workers/wg/configs/probes`,
        { data: { targets: [] } },
      ),
      200,
    ).data;

    expect(put.config.version).to.be.greaterThan(0);
    // Значение не по схеме манифеста — 400.
    expectStatus(
      await call(
        admin,
        "PUT",
        `/api/v1/agents/${agentId}/workers/wg/configs/probes`,
        { data: { targets: "x" } },
      ),
      400,
    );
    expectStatus(
      await call(
        admin,
        "DELETE",
        `/api/v1/agents/${agentId}/workers/wg/configs/probes`,
      ),
      204,
    );
  });

  it("действия: перезапуск воркера, обновления, команда установки, смена ключа", async () => {
    const restarted = expectStatus(
      await call(
        admin,
        "POST",
        `/api/v1/agents/${agentId}/workers/socks/restart`,
        { force: true },
      ),
      200,
    ).data;

    expect(restarted.deferred).to.equal(false);

    // Агент стенда себя не обновляет (update.mode: disabled) — отказ агента.
    const update = await call(
      admin,
      "POST",
      `/api/v1/agents/${agentId}/update`,
    );

    expect(update.status).to.be.at.least(400);

    const workerUpdate = await call(
      admin,
      "POST",
      `/api/v1/agents/${agentId}/workers/wg/update`,
      {},
    );

    expect(workerUpdate.status).to.be.oneOf([200, 409, 502, 503]);

    const command = expectStatus(
      await call(admin, "POST", "/api/v1/agent-releases/install-command", {
        token: "abc.def",
        workers: ["wg", "socks"],
      }),
      200,
    ).data;

    expect(command.command).to.include("--instance 'wg'");

    expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/rotate-key`),
      204,
    );
    await eventually(async () => ((await agentRecord()).online ? true : null), {
      timeoutMs: 20_000,
      what: "агент снова на связи",
    });
  });

  it("привязка агента к другой ноде и копия интерфейса на ней", async () => {
    const other = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", {
        name: "real-node-2",
        publicHost: "203.0.113.151",
      }),
      201,
    ).data.node;
    const replica = expectStatus(
      await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/replicas`, {
        nodeId: other.id,
      }),
      201,
    ).data;

    expect(replica.replicas.map((r: any) => r.nodeId)).to.include(other.id);
    expectStatus(
      await call(
        admin,
        "DELETE",
        `/api/v1/wg/interfaces/${iface.id}/replicas/${other.id}`,
      ),
      204,
    );
    expectStatus(
      await call(admin, "POST", `/api/v1/wg/nodes/${other.id}/agent`, {
        agentId,
      }),
      409,
      "WG_NODE_AGENT_BOUND",
    );
    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/nodes/${other.id}`),
      204,
    );
  });

  it("отзыв и удаление агента: нода без агента", async () => {
    expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/revoke`),
      200,
    );
    expectStatus(await call(admin, "DELETE", `/api/v1/agents/${agentId}`), 204);

    const detached = await eventually(async () => {
      const current = await nodeById(node.id);

      return current.agentId === null ? current : null;
    });

    expect(detached.status).to.equal("created");
    await agent?.stop();
    agent = null;
    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/peers/${peer.id}`),
      204,
    );
    expectStatus(
      await call(admin, "DELETE", `/api/v1/wg/interfaces/${iface.id}`),
      204,
    );
  });
});
