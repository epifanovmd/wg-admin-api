import { expect } from "chai";
import { existsSync } from "fs";
import { join } from "path";

import { enroll, RealAgent } from "./agent";
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
import { AGENT_VERSION } from "./harness";

/**
 * Настоящий агент из сборок агента и воркеры проекта из архива стенда (wg — в
 * имитации `WG_DRY_RUN`, socks): установка на ноду по токену, желаемое
 * состояние и итог применения, сведения об узле, метрики пиров, перезапуск
 * интерфейса командой воркеру, доступ к агенту по правам ноды, удаление
 * агента — уборка воркера на узле, нода без агента.
 */
describe("агент ноды: настоящий агент и воркеры wg (имитация) и socks", function () {
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

  before(async () => {
    admin = await signInAdmin();
    user = await signUp("agents-user");
  });

  after(async () => {
    await agent?.stop();
  });

  it("установка на ноду: агент регистрируется по токену ноды, нода online, воркеры wg и socks, сведения узла", async () => {
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

        // Версия wg — событием node.info воркера, позже связи агента.
        return current.status === "online" && current.wgVersion
          ? current
          : null;
      },
      { timeoutMs: 30_000, what: "нода online, сведения воркера wg" },
    );

    expect(online.agentId).to.equal(agentId);
    expect(online.agentVersion).to.equal(AGENT_VERSION);
    expect(online.wgVersion).to.equal("dry-run");
    expect(online.osInfo).to.include({ wgMode: "userspace" });
    expect(online.osInfo.platform).to.be.a("string");

    const record = await agentRecord();
    const wg = record.workers.find((w: any) => w.name === "wg");

    expect(wg.state).to.equal("running");
    expect(wg.release).to.equal(true);
    expect(wg.manifest.configs.map((c: any) => c.key)).to.deep.equal([
      "state",
      "probes",
    ]);
    expect(wg.manifest.commands.map((c: any) => c.type)).to.deep.equal([
      "interface.restart",
    ]);
    expect(record.workers.find((w: any) => w.name === "socks").state).to.equal(
      "running",
    );

    const list = expectStatus(await call(admin, "GET", "/api/v1/agents"), 200);

    expect(items(list.data).map((a: any) => a.id)).to.include(agentId);
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
    // Конфиг wg-quick имитации — на «узле».
    expect(existsSync(join(agent!.wireguardDir, "wg0.conf"))).to.equal(true);

    // Итог настройки — из состояния агента (раз в stateMs), позже события итога.
    const state = await eventually(async () => {
      const configs = expectStatus(
        await call(admin, "GET", `/api/v1/agents/${agentId}/configs`),
        200,
      ).data;
      const found = configs.find(
        (c: any) => c.worker === "wg" && c.key === "state",
      );

      return found?.state === "applied" ? found : null;
    });

    expect(state.data.version).to.equal(synced.configVersion);
    expect(state.data.interfaces[0].peers).to.have.length(1);

    const events = expectStatus(
      await call(admin, "GET", `/api/v1/agents/events?agentId=${agentId}`),
      200,
    ).data;

    expect(items(events).map((e: any) => e.type)).to.include.members([
      "state.result",
      "node.info",
    ]);
  });

  it("настройки без права на них: итог виден, значение (ключи WireGuard) — нет", async () => {
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
      await call(actor, "GET", `/api/v1/agents/${agentId}/configs`),
      200,
    ).data;
    const state = configs.find(
      (c: any) => c.worker === "wg" && c.key === "state",
    );

    expect(state.state).to.equal("applied");
    expect(state.version).to.be.a("number");
    expect(state).to.not.have.property("data");
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
    for (const path of [
      `/api/v1/wg/stats/window/peer/${peer.id}`,
      `/api/v1/wg/stats/window/interface/${iface.id}`,
      `/api/v1/wg/stats/window/node/${node.id}`,
    ]) {
      expectStatus(await call(admin, "GET", path), 200);
    }
  });

  it("перезапуск интерфейса — команда воркеру wg; журнал агента и воркера", async () => {
    const restarted = expectStatus(
      await call(admin, "POST", `/api/v1/wg/interfaces/${iface.id}/restart`),
      200,
    ).data;

    expect(restarted).to.deep.equal({ name: "wg0", status: "up" });

    const commands = expectStatus(
      await call(admin, "GET", `/api/v1/agents/${agentId}/commands`),
      200,
    ).data;

    expect(commands[0]).to.include({
      worker: "wg",
      workerType: "interface.restart",
      status: "done",
      ok: true,
    });

    const logs = expectStatus(
      await call(admin, "GET", `/api/v1/agents/${agentId}/logs?lines=100`),
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
  });

  it("доступ по правам ноды: владелец ноды видит и управляет её агентом", async () => {
    const owner = await signUp("agents-owner");

    expectStatus(
      await call(admin, "PATCH", `/api/v1/user/setPrivileges/${owner.id}`, {
        roles: ["user"],
        permissions: ["wg:node:view:own", "wg:node:agent:own"],
      }),
      200,
    );
    expectStatus(
      await call(admin, "POST", `/api/v1/wg/nodes/${node.id}/assign`, {
        userId: owner.id,
      }),
      200,
    );

    const actor = await signIn(owner.email, owner.password);
    const seen = expectStatus(
      await call(actor, "GET", `/api/v1/agents/${agentId}`),
      200,
    ).data;

    expect(seen.id).to.equal(agentId);

    const restarted = expectStatus(
      await call(
        actor,
        "POST",
        `/api/v1/agents/${agentId}/workers/socks/restart`,
        { force: true },
      ),
      200,
    ).data;

    expect(restarted).to.include({ type: "worker.restart" });
    await eventually(
      async () =>
        (await agentRecord()).workers.find((w: any) => w.name === "socks")
          ?.state === "running" || null,
      { timeoutMs: 30_000, what: "socks перезапущен" },
    );
  });

  it("токены регистрации и команда установки: создание, список без секрета, отзыв — 401", async () => {
    const created = expectStatus(
      await call(admin, "POST", "/api/v1/agent-enrollment/tokens", {
        name: "e2e-token",
        maxUses: 1,
      }),
      201,
    ).data;
    const list = expectStatus(
      await call(admin, "GET", "/api/v1/agent-enrollment/tokens"),
      200,
    ).data;

    expect(JSON.stringify(list)).to.not.include(created.token);
    expectStatus(
      await call(
        admin,
        "POST",
        `/api/v1/agent-enrollment/tokens/${created.enrollmentToken.id}/revoke`,
      ),
      204,
    );
    expect((await enroll(created.token, "revoked-token")).status).to.equal(401);

    const command = expectStatus(
      await call(admin, "POST", "/api/v1/agent-enrollment/install-command", {
        token: "abc.def",
      }),
      200,
    ).data.command;

    expect(command).to.include("/agent/v1/bundle/install.sh");
    expect(command).to.include("--token 'abc.def'");
    expectStatus(
      await call(user, "GET", "/api/v1/agent-enrollment/tokens"),
      403,
    );
  });

  it("команды и настройки воркеров через агента: итог команды, отмена, своя настройка, метрики", async () => {
    const agentPath = `/api/v1/agents/${agentId}`;
    const done = expectStatus(
      await call(admin, "POST", `${agentPath}/workers/wg/commands`, {
        type: "interface.restart",
        args: { name: "wg0" },
        waitSeconds: 30,
      }),
      200,
    ).data;

    expect(done).to.include({ status: "done", ok: true });
    expect(done.result).to.deep.equal({ name: "wg0", status: "up" });

    const failed = expectStatus(
      await call(admin, "POST", `${agentPath}/workers/wg/commands`, {
        type: "interface.restart",
        args: { name: "wg9" },
        waitSeconds: 30,
      }),
      200,
    ).data;

    expect(failed.ok).to.equal(false);
    expect(failed.error.code).to.equal("INTERFACE_NOT_FOUND");
    expect(
      expectStatus(
        await call(admin, "GET", `${agentPath}/commands/${done.id}`),
        200,
      ).data.id,
    ).to.equal(done.id);
    // Выполненную команду отменять нечего — ответ без ошибки сервера.
    expect(
      (await call(admin, "POST", `${agentPath}/commands/${done.id}/cancel`))
        .status,
    ).to.be.below(500);

    const put = expectStatus(
      await call(admin, "PUT", `${agentPath}/workers/wg/configs/probes`, {
        targets: [],
      }),
      200,
    ).data;

    expect(put.version).to.be.greaterThan(0);
    // Значение не по схеме манифеста — 400.
    expectStatus(
      await call(admin, "PUT", `${agentPath}/workers/wg/configs/probes`, {
        targets: "x",
      }),
      400,
    );
    expectStatus(
      await call(admin, "DELETE", `${agentPath}/workers/wg/configs/probes`),
      204,
    );

    const metrics = await eventually(async () => {
      const res = expectStatus(
        await call(admin, "GET", `${agentPath}/metrics`),
        200,
      ).data;

      return res.length ? res : null;
    });

    expect(metrics[0]).to.have.property("at");
  });

  it("смена ключа и привязка: агент снова на связи; агент другой ноды не привязать", async () => {
    expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/rotate-key`),
      200,
    );
    await eventually(async () => ((await agentRecord()).online ? true : null), {
      timeoutMs: 20_000,
      what: "агент снова на связи",
    });

    const other = expectStatus(
      await call(admin, "POST", "/api/v1/wg/nodes", { name: "real-node-2" }),
      201,
    ).data.node;

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

  it("отзыв: агент остаётся в списке отозванным, нода — «агент отозван»", async () => {
    const revoked = expectStatus(
      await call(admin, "POST", `/api/v1/agents/${agentId}/revoke`),
      200,
    ).data;

    expect(revoked.revoked).to.equal(true);

    const current = await eventually(async () => {
      const res = await nodeById(node.id);

      return res.status === "created" ? res : null;
    });

    expect(current.statusMessage).to.equal("Агент отозван");
  });

  it("удаление агента: воркер wg убирает созданное на узле, агент отозван, нода без агента", async () => {
    expectStatus(await call(admin, "DELETE", `/api/v1/agents/${agentId}`), 204);

    const detached = await eventually(async () => {
      const current = await nodeById(node.id);

      return current.agentId === null ? current : null;
    });

    expect(detached.status).to.equal("created");
    expect(detached).to.include({
      agentVersion: null,
      wgVersion: null,
      osInfo: null,
      agentRemoteIp: null,
      lastSeenAt: null,
      appliedVersion: 0,
    });

    // Отозванный агент останавливает воркеры с уборкой.
    await eventually(
      async () =>
        !existsSync(join(agent!.wireguardDir, "wg0.conf")) ? true : null,
      { timeoutMs: 30_000, what: "уборка воркера wg" },
    );

    const unknown = await eventually(async () => {
      const res = await call(admin, "GET", `/api/v1/wg/interfaces/${iface.id}`);

      return res.data.status === "unknown" ? res.data : null;
    });

    expect(unknown.status).to.equal("unknown");
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
